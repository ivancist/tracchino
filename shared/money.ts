// Money is always integer cents. Parsing never goes through floating point.

const EUR = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
const PLAIN = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Parses a user-typed euro amount into cents: "1,89" → 189, "1.234,5" → 123450, "€ 2" → 200.
 * Returns null for empty, negative, malformed input or more than 2 decimals.
 */
export function parseEuroToCents(input: string): number | null {
  let s = input.replace(/[€\s]/g, ""); // \s also matches NBSP
  if (s === "") return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // Both separators: the last one is the decimal separator, the other is thousands.
    const dec = lastComma > lastDot ? "," : ".";
    const thousands = dec === "," ? "." : ",";
    s = s.split(thousands).join("").replace(dec, ".");
  } else if (lastComma >= 0) {
    s = s.replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    // "1.234" (only dots, groups of 3) is a thousands separator, not 3 decimals.
    s = s.split(".").join("");
  }

  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const euros = Number(m[1]);
  const cents = Number((m[2] ?? "").padEnd(2, "0"));
  const total = euros * 100 + cents;
  return Number.isSafeInteger(total) ? total : null;
}

/** "€ 1,89"-style string for display. */
export function formatCents(cents: number): string {
  return EUR.format(cents / 100);
}

/** "1,89" for prefilling inputs (no currency symbol). */
export function centsToInput(cents: number): string {
  return PLAIN.format(cents / 100).replace(/\./g, "");
}
