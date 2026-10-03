// Pantry wording that is pure data → text (shared by the UI pages; tested in test/ui).
import type { PantryItem } from "./api";
import { daysBetween, formatShortDate, todayRome } from "./dates";
import { formatCents } from "./money";
import { perPackageCents, unitPrices } from "./pricing";
import { formatAmount, perKiloSuffix } from "./quantity";

export const productTitle = (p: { name: string; brand: string | null }) => (p.brand ? `${p.name} (${p.brand})` : p.name);
export const grams = (g: number, unit: PantryItem["unit"] | null) => formatAmount(Math.round(g), unit ?? "g");

/** "domani (4 ott)", "tra 6 giorni (9 ott)" */
export function whenText(date: string): string {
  const d = daysBetween(todayRome(), date);
  const rel = d <= 0 ? "oggi" : d === 1 ? "domani" : `tra ${d} giorni`;
  return `${rel} (${formatShortDate(date)})`;
}

export const isFinished = (item: PantryItem) => item.stock != null && item.stock.amount <= 0;

/** Bought and counted by the piece (bananas, eggs): stock is shown in pieces. Packaged products stay in g/ml. */
const byPiece = (item: PantryItem) => item.avgPieceAmount != null && item.packageAmount == null;

/** "480 g", "≈ 3 pezzi (195 g)", "meno di 1 pezzo (40 g)". */
export function leftText(item: PantryItem): string {
  const s = item.stock!;
  const g = grams(s.amount, item.unit);
  if (byPiece(item)) {
    const n = Math.round(s.amount / item.avgPieceAmount!);
    return n < 1 ? `meno di 1 pezzo (${g})` : `≈ ${n} ${n === 1 ? "pezzo" : "pezzi"} (${g})`;
  }
  return `${s.estimated ? "≈ " : ""}${g}`;
}

/** "Restano ≈ 200 g · finisce domani (4 ott)"; "Finito"; unknown stock explained. */
export function stockText(item: PantryItem): string {
  if (!item.stock) return "Scorta sconosciuta: non risulta comprato nell'app (o la quantità comprata non è nota)";
  if (item.stock.amount <= 0) return "Finito";
  const left = `Restano ${leftText(item)}`;
  return item.forecast ? `${left} · finisce ${whenText(item.forecast.runOutDate)}` : left;
}

/** Latest price at a glance: "0,59 € a conf." for packaged products, else per piece or per kg/l. */
export function lastPriceText(item: PantryItem): string | null {
  const last = item.lastPurchase;
  if (!last) return null;
  const u = unitPrices({ ...last, priceFullCents: last.paidCents, discountCents: 0 }, item);
  if (item.packageAmount != null) return `${formatCents(perPackageCents(u.paidCents, last.packages) ?? u.paidCents)} a conf.`;
  if (u.perPiece != null) return `${formatCents(u.perPiece)}/pz`;
  if (u.perKilo) return `${u.perKilo.source === "estimated" ? "≈ " : ""}${formatCents(u.perKilo.cents)}${perKiloSuffix(item.unit)}`;
  return null;
}
