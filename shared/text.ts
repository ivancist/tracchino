// Text normalization and fuzzy search, shared by the product autocomplete (UI)
// and, later, receipt-line matching (Worker).

/** Lowercase, strip accents, punctuation → spaces, collapse whitespace. "Banane  Chiquità!" → "banane chiquita" */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function trigrams(s: string): Set<string> {
  const padded = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

/** Dice coefficient on character trigrams, 0..1. */
export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return (2 * common) / (ta.size + tb.size);
}

/**
 * Relevance of `candidate` for `query`, 0..1 (0 = no match). Both must already be normalized.
 * Every query token must prefix a candidate token ("ban chiq" → "banane chiquita") for a strong match;
 * otherwise falls back to trigram similarity so typos still surface ("bananne").
 */
export function matchScore(query: string, candidate: string): number {
  if (!query) return 0;
  if (candidate === query) return 1;
  const qTokens = query.split(" ");
  const cTokens = candidate.split(" ");
  const allPrefix = qTokens.every((q) => cTokens.some((c) => c.startsWith(q)));
  if (allPrefix) {
    const startsWell = candidate.startsWith(qTokens[0]!) ? 0.05 : 0;
    // Prefer candidates where the query covers more of the text.
    return Math.min(0.99, 0.75 + startsWell + 0.2 * (query.length / candidate.length));
  }
  if (candidate.includes(query)) return 0.7;
  const sim = trigramSimilarity(query, candidate);
  return sim >= 0.35 ? sim * 0.6 : 0;
}

/**
 * Ranks items for a query. `boost` (0..1, e.g. purchase frequency) only breaks near-ties,
 * so a frequently bought product wins between similar matches but never beats a clearly better one.
 */
export function rankByQuery<T>(
  query: string,
  items: readonly T[],
  text: (item: T) => string,
  boost: (item: T) => number = () => 0,
  limit = 8,
): T[] {
  const q = normalizeText(query);
  if (!q) return [...items].sort((a, b) => boost(b) - boost(a)).slice(0, limit);
  return items
    .map((item) => ({ item, score: matchScore(q, normalizeText(text(item))) }))
    .filter((r) => r.score > 0)
    .map((r) => ({ ...r, score: r.score + 0.1 * boost(r.item) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.item);
}
