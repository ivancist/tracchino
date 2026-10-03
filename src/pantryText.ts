// Pantry wording shared by the shopping list, products, the product page and the consumption stats.
import type { PantryItem } from "../shared/api";
import { daysBetween, formatShortDate, todayRome } from "../shared/dates";
import { formatCents } from "../shared/money";
import { MIN_RATE_DAYS } from "../shared/pantry";
import { formatAmount } from "../shared/quantity";
import { formatNumber } from "./format";

export const productTitle = (p: { name: string; brand: string | null }) => (p.brand ? `${p.name} (${p.brand})` : p.name);
export const grams = (g: number, unit: PantryItem["unit"] | null) => formatAmount(Math.round(g), unit ?? "g");

/** "domani (4 ott)", "tra 6 giorni (9 ott)" */
export function whenText(date: string): string {
  const d = daysBetween(todayRome(), date);
  const rel = d <= 0 ? "oggi" : d === 1 ? "domani" : `tra ${d} giorni`;
  return `${rel} (${formatShortDate(date)})`;
}

export const isFinished = (item: PantryItem) => item.stock != null && item.stock.amount <= 0;

/** "Restano ≈ 200 g · finisce domani (4 ott)"; "Finito"; unknown stock explained. */
export function stockText(item: PantryItem): string {
  if (!item.stock) return "Scorta sconosciuta: non risulta comprato nell'app (o la quantità comprata non è nota)";
  if (item.stock.amount <= 0) return "Finito";
  const left = `Restano ${item.stock.estimated ? "≈ " : ""}${grams(item.stock.amount, item.unit)}`;
  return item.forecast ? `${left} · finisce ${whenText(item.forecast.runOutDate)}` : left;
}

/** "Mangiato in 4 giorni su 4 registrati" (last 30 days, since first eaten). */
export function frequencyText(item: PantryItem): string | null {
  if (!item.rate) return null;
  const { eatenDays, days } = item.rate;
  return `Mangiato in ${eatenDays} ${eatenDays === 1 ? "giorno" : "giorni"} su ${days} ${days === 1 ? "registrato" : "registrati"}`;
}

/** "200 g al giorno · 1 confezione ogni 5 giorni · 6 al mese · 26,40 € al mese" */
export function consumptionText(item: PantryItem): string {
  if (!item.rate) return "Non mangiato negli ultimi 30 giorni";
  if (item.rate.days < MIN_RATE_DAYS) {
    const days = item.rate.days === 1 ? "1 giorno" : `${item.rate.days} giorni`;
    return `Diario di ${days} da quando l'hai mangiato: per consumi e previsioni ne servono almeno ${MIN_RATE_DAYS}`;
  }
  return [
    `${grams(item.rate.perDay, item.unit)} al giorno`,
    item.packageEveryDays != null && `1 confezione ogni ${formatNumber(item.packageEveryDays)} giorni`,
    item.packagesPerMonth != null && `${formatNumber(item.packagesPerMonth)} al mese`,
    item.costPerMonthCents != null ? `${item.costEstimated ? "≈ " : ""}${formatCents(item.costPerMonthCents)} al mese` : "costo n.d.",
  ]
    .filter(Boolean)
    .join(" · ");
}
