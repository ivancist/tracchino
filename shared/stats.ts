import { addDays, eachDay, weekStart } from "./dates";
import { resolveAmount, type ProductQuantityInfo } from "./pricing";

/** Arithmetic mean rounded to the cent; null for no data. */
export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/** Median (average of the two middle values for an even count, rounded); null for no data. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

export type DayTotal = { date: string; totalCents: number };
export type WeekTotal = { weekStart: string; totalCents: number; complete: boolean };

export type SpendingSummary = {
  from: string;
  to: string;
  totalCents: number;
  days: DayTotal[];
  weeks: WeekTotal[];
  daily: { mean: number | null; median: number | null; count: number };
  /** Over every ISO week touching the period, partial edge weeks included (owner's choice, PLAN §8). */
  weekly: { mean: number | null; median: number | null; count: number; partial: number };
};

/**
 * Spending per day and per ISO week over [from, to], counting days and weeks without purchases as 0
 * (PLAN §8: statistics over all calendar days and all weeks). `complete` only marks partial edge weeks for display.
 */
export function summarizeSpending(byDate: ReadonlyMap<string, number>, from: string, to: string): SpendingSummary {
  const days = eachDay(from, to).map((date) => ({ date, totalCents: byDate.get(date) ?? 0 }));

  const weekMap = new Map<string, number>();
  for (const d of days) weekMap.set(weekStart(d.date), (weekMap.get(weekStart(d.date)) ?? 0) + d.totalCents);
  const weeks = [...weekMap.entries()].map(([start, totalCents]) => ({
    weekStart: start,
    totalCents,
    complete: start >= from && addDays(start, 6) <= to,
  }));

  const dayValues = days.map((d) => d.totalCents);
  const weekValues = weeks.map((w) => w.totalCents);
  return {
    from,
    to,
    totalCents: dayValues.reduce((a, b) => a + b, 0),
    days,
    weeks,
    daily: { mean: mean(dayValues), median: median(dayValues), count: dayValues.length },
    weekly: {
      mean: mean(weekValues),
      median: median(weekValues),
      count: weekValues.length,
      partial: weeks.filter((w) => !w.complete).length,
    },
  };
}

/** One receipt line with its product's quantity info (lines of a group can come from different products). */
export type PurchaseLine = ProductQuantityInfo & {
  date: string;
  storeId: number;
  storeName: string;
  chainName: string;
  pieces: number | null;
  amount: number | null;
  pricePaidCents: number;
};

export type StorePriceStats = {
  storeId: number;
  storeName: string;
  chainName: string;
  purchases: number;
  lastDate: string;
  /** Total paid / total quantity over lines with a known quantity; `estimated` if any of them was estimated. */
  perKilo: { cents: number; estimated: boolean; lines: number } | null;
  /** Total paid / total pieces over lines with pieces. */
  perPiece: { cents: number; lines: number } | null;
  lastPaidCents: number;
};

/**
 * Price comparison by store, computed from raw paid cents and quantities (never from rounded unit prices).
 * Sorted cheapest first on the chosen metric; stores without that metric go last.
 */
export type PriceMetric = "kilo" | "piece";

/** Weight and volume can't be summed together: €/kg and €/l are different metrics. "pz" sizes are grams. */
const volumeFamily = (unit: PurchaseLine["unit"]) => unit === "ml";

export function priceStatsByStore(
  lines: readonly PurchaseLine[],
  opts: { metric: PriceMetric; volume: boolean } = { metric: "kilo", volume: false },
): StorePriceStats[] {
  const groups = new Map<number, PurchaseLine[]>();
  for (const l of lines) groups.set(l.storeId, [...(groups.get(l.storeId) ?? []), l]);

  const stats = [...groups.values()].map((group): StorePriceStats => {
    const latest = [...group].sort((a, b) => (a.date < b.date ? 1 : -1))[0]!;
    let paidK = 0;
    let amountK = 0;
    let linesK = 0;
    let estimated = false;
    let paidP = 0;
    let pieces = 0;
    let linesP = 0;
    for (const l of group) {
      // Only lines of the reference unit family count towards €/kg (or €/l): a group mixing g and ml never blends them.
      const resolved = volumeFamily(l.unit) === opts.volume ? resolveAmount(l, l) : null;
      if (resolved) {
        paidK += l.pricePaidCents;
        amountK += resolved.amount;
        linesK++;
        if (resolved.source === "estimated") estimated = true;
      }
      if (l.pieces != null && l.pieces > 0) {
        paidP += l.pricePaidCents;
        pieces += l.pieces;
        linesP++;
      }
    }
    return {
      storeId: latest.storeId,
      storeName: latest.storeName,
      chainName: latest.chainName,
      purchases: group.length,
      lastDate: latest.date,
      perKilo: amountK > 0 ? { cents: Math.round((paidK * 1000) / amountK), estimated, lines: linesK } : null,
      perPiece: pieces > 0 ? { cents: Math.round(paidP / pieces), lines: linesP } : null,
      lastPaidCents: latest.pricePaidCents,
    };
  });

  // Rank on ONE metric only; stores without it go last (never compare a €/kg against a €/pz).
  const key = (s: StorePriceStats) =>
    (opts.metric === "kilo" ? s.perKilo?.cents : s.perPiece?.cents) ?? Number.POSITIVE_INFINITY;
  return stats.sort((a, b) => key(a) - key(b));
}

export type Frequency = {
  purchases: number;
  days: number;
  firstDate: string | null;
  lastDate: string | null;
  /** Average days between distinct purchase days; null with fewer than 2 days. */
  avgIntervalDays: number | null;
};

/** Average gap (1 decimal) between `days` distinct purchase days spanning first → last; null with fewer than 2. */
export function avgIntervalDays(first: string | null, last: string | null, days: number): number | null {
  if (!first || !last || days < 2) return null;
  const span = (Date.parse(last) - Date.parse(first)) / 86_400_000;
  return Math.round((span / (days - 1)) * 10) / 10;
}

export function purchaseFrequency(dates: readonly string[]): Frequency {
  const distinct = [...new Set(dates)].sort();
  const first = distinct[0] ?? null;
  const last = distinct.at(-1) ?? null;
  return {
    purchases: dates.length,
    days: distinct.length,
    firstDate: first,
    lastDate: last,
    avgIntervalDays: avgIntervalDays(first, last, distinct.length),
  };
}

