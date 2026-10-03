import { Hono } from "hono";
import type { ScanLine, ScanResult } from "../../shared/api";
import { todayRome } from "../../shared/dates";
import type { AppEnv } from "../app";
import { HttpError, parseImage } from "../http";
import { AiError, type ProductChoice, type ReceiptAi } from "../services/ai/types";
import { mergeDuplicateLines, prepareLines } from "../services/scan-lines";
import { decide, findCandidates, matchStore, type Alias, type CatalogProduct, type CatalogStore } from "../services/matching";

/** Safety cap, far below the free tier (a few receipts a day; each scan = 1–2 model calls). */
export const SCAN_DAILY_LIMIT = 30;

export type AiFactory = (env: Env) => ReceiptAi | null;

async function bumpUsage(db: D1Database, column: "scans" | "ai_calls", by = 1): Promise<number> {
  const row = await db
    .prepare(
      `insert into ai_usage (day, ${column}) values (?1, ?2)
       on conflict(day) do update set ${column} = ${column} + ?2
       returning ${column} as n`,
    )
    .bind(todayRome(), by)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function loadCatalog(db: D1Database) {
  const [products, aliases, stores] = await db.batch<unknown>([
    db.prepare("select id, name, brand from products"),
    db.prepare("select chain_id as chainId, raw_text_norm as rawTextNorm, product_id as productId from product_aliases"),
    db.prepare(
      `select s.id, s.chain_id as chainId, ch.name as chainName, s.name, s.address, s.vat_number as vatNumber
         from stores s join chains ch on ch.id = s.chain_id
         left join receipts r on r.store_id = s.id
        group by s.id
        order by max(r.date) is null, max(r.date) desc`,
    ),
  ]);
  return {
    products: products!.results as CatalogProduct[],
    aliases: aliases!.results as Alias[],
    stores: stores!.results as CatalogStore[],
  };
}

export function createScanRoutes(aiFactory: AiFactory) {
  return new Hono<AppEnv>().post("/", async (c) => {
    const ai = aiFactory(c.env);
    if (!ai) throw new HttpError(503, { error: "internal_error", message: "Scansione non configurata (manca la chiave AI)" });
    const image = await parseImage(c);

    const used = await bumpUsage(c.env.DB, "scans");
    if (used > SCAN_DAILY_LIMIT) {
      throw new HttpError(429, { error: "conflict", message: `Limite di ${SCAN_DAILY_LIMIT} scansioni al giorno raggiunto: riprova domani` });
    }

    let extracted;
    try {
      await bumpUsage(c.env.DB, "ai_calls");
      extracted = await ai.extract(image);
    } catch (err) {
      if (err instanceof AiError) {
        // The provider failed (overloaded, quota, bad output): the scan doesn't count against our own cap.
        // ai_calls keeps counting every attempt.
        await bumpUsage(c.env.DB, "scans", -1);
        throw new HttpError(502, { error: "internal_error", message: err.message });
      }
      throw err;
    }

    const catalog = await loadCatalog(c.env.DB);
    const store = matchStore(extracted.store, catalog.stores);
    const chain = catalog.stores.find((s) => s.chainId === store.chainId);
    const extractedLines = mergeDuplicateLines(prepareLines(extracted.lines));
    const found = extractedLines.map((l) => findCandidates(l.rawText, store.chainId, catalog.products, catalog.aliases));

    // Second pass (text only) for every line that is not a known alias.
    const pending = found.flatMap((f, index) =>
      f.aliasProductId != null
        ? []
        : [{
            index,
            rawText: f.rawTextNorm,
            candidates: f.candidates.map((cand) => {
              const p = catalog.products.find((x) => x.id === cand.productId)!;
              return { id: p.id, name: p.brand ? `${p.name} (${p.brand})` : p.name };
            }),
          }],
    );
    let choices: ProductChoice[] = [];
    let aiMatching = pending.length === 0;
    if (pending.length > 0) {
      try {
        await bumpUsage(c.env.DB, "ai_calls");
        choices = await ai.chooseProducts({ chain: chain?.chainName ?? extracted.store.name, lines: pending });
        aiMatching = true;
      } catch (err) {
        // Text similarity alone still gives usable proposals; the review screen says so.
        console.error("scan: AI matching failed:", err instanceof Error ? err.message.slice(0, 200) : "unknown");
      }
    }

    const lines: ScanLine[] = extractedLines.map((l, index) => {
      const match = decide(found[index]!, aiMatching ? choices.find((ch) => ch.index === index) : undefined);
      return {
        rawText: l.rawText,
        rawTextNorm: match.rawTextNorm,
        priceCents: l.priceCents,
        discountCents: Math.min(l.discountCents, l.priceCents),
        packages: l.packages,
        pieces: l.pieces,
        amount: l.amountGrams,
        productId: match.productId,
        status: match.status,
        candidates: match.candidates,
        suggestedName: match.suggestedName,
      };
    });

    const body: ScanResult = {
      model: ai.name,
      aiMatching,
      store: { ...extracted.store, storeId: store.storeId, status: store.status },
      date: extracted.date,
      totalCents: extracted.totalCents,
      lines,
      scansLeft: Math.max(0, SCAN_DAILY_LIMIT - used),
    };
    return c.json(body);
  });
}
