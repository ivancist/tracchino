import { normalizeRawText } from "../../shared/receipt-text";
import { matchScore, normalizeText, trigramSimilarity } from "../../shared/text";
import type { ProductChoice } from "./ai/types";

// Receipt line → product matching (PLAN §5). Pure functions: data in, decisions out.

export type CatalogProduct = { id: number; name: string; brand: string | null };
export type Alias = { chainId: number; rawTextNorm: string; productId: number };
export type CatalogStore = {
  id: number;
  chainId: number;
  chainName: string;
  name: string;
  address: string | null;
  vatNumber: string | null;
};

/** green = known alias (automatic) · yellow = proposed, to confirm · red = uncertain or new product */
export type MatchStatus = "alias" | "proposed" | "uncertain" | "none";

export type Candidate = { productId: number; score: number };
export type LineMatch = {
  rawTextNorm: string;
  productId: number | null;
  status: MatchStatus;
  candidates: Candidate[];
  suggestedName: string | null;
};

const label = (p: CatalogProduct) => (p.brand ? `${p.name} ${p.brand}` : p.name);

const significant = (tokens: string[]) => tokens.filter((t) => t.length >= 3 && /^\p{L}+$/u.test(t));
/** "pomod" ~ "pomodoro" (abbreviation), "sgombri" ~ "sgombro" (same stem, ≥ 4 letters). */
function sameWord(a: string, b: string): boolean {
  if (a.startsWith(b) || b.startsWith(a)) return true;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return i >= 4 && i >= Math.min(a.length, b.length) - 2;
}

/**
 * Receipt lines carry other words than the product name ("UOVA A TERRA XL 6P" → "Uova"). Every product word found in
 * the line (abbreviated or inflected) → candidate, stronger the more of the line it explains (0.55–0.8). Only the
 * first word (usually the noun: "Uova fresche") → weak candidate (0.3–0.5), for the AI second pass to judge.
 * Both inputs normalized.
 */
export function coverageScore(line: string, product: string): number {
  const p = significant(product.split(" "));
  const l = significant(line.split(" "));
  if (p.length === 0 || l.length === 0) return 0;
  const found = (pt: string) => l.some((lt) => sameWord(lt, pt));
  const covered = p.filter(found).length / p.length;
  if (covered === 1) return 0.55 + 0.25 * (l.filter((lt) => p.some((pt) => sameWord(lt, pt))).length / l.length);
  return found(p[0]!) ? 0.3 + 0.2 * covered : 0;
}

/** Step 1 + 2: exact alias on the chain, else fuzzy candidates (product names and other chains' aliases). */
export function findCandidates(
  rawText: string,
  chainId: number | null,
  products: readonly CatalogProduct[],
  aliases: readonly Alias[],
): { rawTextNorm: string; aliasProductId: number | null; candidates: Candidate[] } {
  const rawTextNorm = normalizeRawText(rawText);
  const exact = chainId != null ? aliases.find((a) => a.chainId === chainId && a.rawTextNorm === rawTextNorm) : undefined;
  if (exact) return { rawTextNorm, aliasProductId: exact.productId, candidates: [{ productId: exact.productId, score: 1 }] };

  const query = normalizeText(rawTextNorm);
  const best = new Map<number, number>();
  const offer = (productId: number, score: number) => {
    if (score > (best.get(productId) ?? 0)) best.set(productId, score);
  };
  for (const p of products) {
    const name = normalizeText(label(p));
    offer(p.id, Math.max(matchScore(query, name), coverageScore(query, name)));
  }
  for (const a of aliases) {
    // Same abbreviation seen at another chain is a strong hint; similar abbreviations are weaker.
    if (a.rawTextNorm === rawTextNorm) offer(a.productId, 0.9);
    else offer(a.productId, trigramSimilarity(query, normalizeText(a.rawTextNorm)) * (a.chainId === chainId ? 0.85 : 0.75));
  }
  const candidates = [...best.entries()]
    .map(([productId, score]) => ({ productId, score: Math.round(score * 100) / 100 }))
    .filter((c) => c.score >= 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  return { rawTextNorm, aliasProductId: null, candidates };
}

/** "BAN.CHIQ" → "Ban Chiq": a readable fallback name for a new product. */
export function titleCase(rawTextNorm: string): string {
  return rawTextNorm
    .toLowerCase()
    .replace(/\./g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(^|\s)\p{L}/gu, (m) => m.toUpperCase());
}

/** Step 3–4: combine fuzzy candidates with the (optional) AI choice into a status and a preselected product. */
export function decide(
  found: ReturnType<typeof findCandidates>,
  ai: ProductChoice | undefined,
): LineMatch {
  const { rawTextNorm, aliasProductId, candidates } = found;
  if (aliasProductId != null) return { rawTextNorm, productId: aliasProductId, status: "alias", candidates, suggestedName: null };

  const top = candidates[0];
  const second = candidates[1];
  const suggestedName = ai?.newName ?? titleCase(rawTextNorm);
  const result = (productId: number | null, status: MatchStatus): LineMatch => ({
    rawTextNorm,
    productId,
    status,
    candidates,
    suggestedName: productId == null ? suggestedName : null,
  });

  if (ai) {
    if (ai.productId != null && ai.productId === top?.productId && top.score >= 0.5) return result(top.productId, "proposed");
    if (ai.productId != null) return result(ai.productId, "uncertain"); // AI and text similarity disagree
    if (top && top.score >= 0.85) return result(top.productId, "uncertain"); // AI says new, text says similar
    return result(null, "none");
  }
  // No AI second pass (disabled, quota, error): text similarity only, stricter.
  if (top && top.score >= 0.8 && (!second || top.score - second.score >= 0.1)) return result(top.productId, "proposed");
  if (top && top.score >= 0.4) return result(top.productId, "uncertain");
  return result(null, "none");
}

export type StoreMatch = {
  storeId: number | null;
  chainId: number | null;
  status: "vat" | "chain" | "none";
};

/**
 * Among same-company stores, the one whose name/address resembles the printed address; null if none clearly does.
 * Stores come ordered by last use, so ties go to the most recent.
 */
function byAddress(address: string | null, stores: readonly CatalogStore[]): CatalogStore | null {
  if (!address) return null;
  const q = normalizeText(address);
  let best: { store: CatalogStore; score: number } | null = null;
  for (const s of stores) {
    const score = Math.max(...[s.address, s.name].filter((t): t is string => !!t).map((t) => trigramSimilarity(q, normalizeText(t))), 0);
    if (score >= 0.5 && score > (best?.score ?? 0)) best = { store: s, score };
  }
  return best?.store ?? null;
}

/**
 * Store: by VAT number (reliable for the company; a company has many branches), else by chain name. Among the
 * company's or chain's stores the printed address picks the branch; otherwise the most recently used one is
 * preselected and the status says "check it" (`chain`).
 */
export function matchStore(
  extracted: { name: string | null; address?: string | null; vatNumber: string | null },
  stores: readonly CatalogStore[],
): StoreMatch {
  if (extracted.vatNumber) {
    const sameVat = stores.filter((s) => s.vatNumber?.replace(/\D/g, "") === extracted.vatNumber);
    if (sameVat.length > 0) {
      const branch = sameVat.length === 1 ? sameVat[0]! : byAddress(extracted.address ?? null, sameVat);
      const store = branch ?? sameVat[0]!;
      return { storeId: store.id, chainId: store.chainId, status: branch ? "vat" : "chain" };
    }
  }
  if (extracted.name) {
    const q = normalizeText(extracted.name);
    let bestChain: { chainId: number; score: number } | null = null;
    for (const s of stores) {
      const chain = normalizeText(s.chainName);
      const score = Math.max(matchScore(chain, q), matchScore(q, chain));
      if (score >= 0.75 && score > (bestChain?.score ?? 0)) bestChain = { chainId: s.chainId, score };
    }
    if (bestChain) {
      const chainStores = stores.filter((s) => s.chainId === bestChain.chainId); // ordered by last use
      const store = byAddress(extracted.address ?? null, chainStores) ?? chainStores[0]!;
      return { storeId: store.id, chainId: bestChain.chainId, status: "chain" };
    }
  }
  return { storeId: null, chainId: null, status: "none" };
}
