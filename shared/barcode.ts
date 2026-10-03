// Product barcodes: GTIN-8 (EAN-8), GTIN-12 (UPC-A), GTIN-13 (EAN-13), GTIN-14 — digits with a check digit.

/** UPC-E (8 digits starting with 0/1) is printed compressed; expands it to the equivalent UPC-A. */
function upcEToUpcA(code: string): string | null {
  if (!/^[01]\d{7}$/.test(code)) return null;
  const [ns, d1, d2, d3, d4, d5, d6, check] = code.split("") as [string, string, string, string, string, string, string, string];
  let body: string;
  if ("012".includes(d6)) body = `${d1}${d2}${d6}0000${d3}${d4}${d5}`;
  else if (d6 === "3") body = `${d1}${d2}${d3}00000${d4}${d5}`;
  else if (d6 === "4") body = `${d1}${d2}${d3}${d4}00000${d5}`;
  else body = `${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  return `${ns}${body}${check}`;
}

function hasValidCheckDigit(code: string): boolean {
  const digits = code.split("").map(Number);
  const check = digits.pop()!;
  // From the right (excluding the check digit), weights alternate 3, 1, 3, …
  const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/** True for a well-formed GTIN-8/12/13/14 (or UPC-E) with a correct check digit. */
export function isValidGtin(code: string): boolean {
  if (!/^(\d{8}|\d{12,14})$/.test(code)) return false;
  if (hasValidCheckDigit(code)) return true;
  const upcA = code.length === 8 ? upcEToUpcA(code) : null;
  return upcA != null && hasValidCheckDigit(upcA);
}

/**
 * Canonical form for storage and lookups: UPC-E (8 digits that are not a valid EAN-8) expanded to its 13-digit
 * EAN form, the one Open Food Facts and other scans of the same product use. Assumes `isValidGtin(code)`.
 */
export function normalizeGtin(code: string): string {
  if (code.length !== 8 || hasValidCheckDigit(code)) return code;
  const upcA = upcEToUpcA(code);
  return upcA ? `0${upcA}` : code;
}

/** Keeps the digits only ("8 001234 567893" → "8001234567893"); scanners and typing add spaces. */
export const cleanBarcode = (raw: string) => raw.replace(/\D/g, "");
