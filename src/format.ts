// Number formatting at the UI edge (Italian). Money has its own helpers in shared/money.ts.

const formatters = new Map<number, Intl.NumberFormat>();

/** "12,5" — at most `digits` decimals, none when not needed. */
export function formatNumber(value: number, digits = 1): string {
  let f = formatters.get(digits);
  if (!f) formatters.set(digits, (f = new Intl.NumberFormat("it-IT", { maximumFractionDigits: digits })));
  return f.format(value);
}

const SMALL_EUR = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 3, maximumFractionDigits: 3 });
const EUR = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });

/** A derived amount in (possibly fractional) cents: 3 decimals below 10 cents ("0,004 €"), else to the cent. */
export function formatDerivedCents(cents: number): string {
  return Math.abs(cents) < 10 ? SMALL_EUR.format(cents / 100) : EUR.format(Math.round(cents) / 100);
}

/** Decimal typed with a comma or a dot; empty or invalid → null. */
export function parseDecimalInput(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (!t || !/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}
