// Pantry wording shared by the shopping list, products, the product page and the statistics.
import type { PantryItem } from "../shared/api";
import { formatCents } from "../shared/money";
import { MIN_RATE_DAYS } from "../shared/pantry";
import { grams } from "../shared/pantry-text";
import { formatNumber } from "./format";

export { grams, isFinished, lastPriceText, leftText, productTitle, stockText, whenText } from "../shared/pantry-text";

/** "Mangiato in 4 giorni su 4 registrati" (last 30 days, since first eaten). */
export function frequencyText(item: PantryItem): string | null {
  if (!item.rate) return null;
  const { eatenDays, days } = item.rate;
  return `Mangiato in ${eatenDays} ${eatenDays === 1 ? "giorno" : "giorni"} su ${days} ${days === 1 ? "registrato" : "registrati"}`;
}

/** "100 g a pasto · 1 confezione ogni 5 giorni · 6 al mese · 26,40 € al mese" (per meal: what is actually eaten each time). */
export function consumptionText(item: PantryItem): string {
  if (!item.rate) return "Non mangiato negli ultimi 30 giorni";
  if (item.rate.days < MIN_RATE_DAYS) {
    const days = item.rate.days === 1 ? "1 giorno" : `${item.rate.days} giorni`;
    return `Diario di ${days} da quando l'hai mangiato: per consumi e previsioni ne servono almeno ${MIN_RATE_DAYS}`;
  }
  return [
    `${grams(item.rate.typicalMeal, item.unit)} a pasto`,
    item.packageEveryDays != null && `1 confezione ogni ${formatNumber(item.packageEveryDays)} giorni`,
    item.packagesPerMonth != null && `${formatNumber(item.packagesPerMonth)} al mese`,
    item.costPerMonthCents != null ? `${item.costEstimated ? "≈ " : ""}${formatCents(item.costPerMonthCents)} al mese` : "costo n.d.",
  ]
    .filter(Boolean)
    .join(" · ");
}
