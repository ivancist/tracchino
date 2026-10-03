// Receipt line text: the key of the per-chain alias dictionary ("BAN.CHIQ." at Esselunga → Banane Chiquita).

/**
 * Canonical form of a printed receipt line, used as alias key:
 * uppercase, no accents, a trailing price / VAT or department code removed, punctuation reduced to dots,
 * no space after a dot, single spaces, no trailing dot.
 * "Ban. Chiq.  1,79 A" → "BAN.CHIQ". Trailing whole numbers are sizes, not prices, and stay:
 * "SGOMBRI GR.NAT. 120" and "SGOMBRI GR.NAT.120" → "SGOMBRI GR.NAT.120".
 */
export function normalizeRawText(raw: string): string {
  let s = raw
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}.%]+/gu, " ")
    .trim();
  // Trailing junk printed after the description: price ("1.79", "1 79"), VAT %, VAT/department code ("A", "*").
  for (let i = 0; i < 4; i++) {
    const before = s;
    s = s
      .replace(/\s+\d+(?:\.|\s)\d{2}$/u, "") // price with decimals: "1.79", or "1,79" (comma became a space)
      .replace(/\s+\d{1,2}%$/u, "") // VAT rate
      .replace(/\s+[A-Z]$/u, "") // VAT / department letter
      .trim();
    if (s === before) break;
  }
  return s
    .replace(/\.\s+/g, ".")
    .replace(/\s+/g, " ")
    .replace(/\.+$/g, "")
    .trim();
}

/**
 * Pieces printed in the description, e.g. "UOVA FRESCHE 6P", "UOVA 12 PZ", "YOGURT X4".
 * Read from the text on every scan (never stored on the alias: packs vary between purchases).
 */
export function piecesHint(raw: string): number | null {
  const s = raw.toUpperCase();
  const m = /\b(\d{1,3})\s?(?:P|PZ|PZZ|PEZZI)\b/.exec(s) ?? /\bX\s?(\d{1,3})\b/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 ? n : null;
}
