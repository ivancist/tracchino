/**
 * Receipt-scan eval (skill `receipt-eval`): real photos in fixtures/receipts/<id>/image.jpg against a hand-written
 * expected.json. Uses the same code as the Worker (Gemini client, normalization, matching).
 *
 *   docker compose exec dev npm run eval:receipts -- [--model <id>] [--no-ai-match] [--only <id>] [--yes]
 *
 * Photos are compressed exactly like the phone does it (src/image.ts run in Chromium through the Vite dev server,
 * which must be running) and cached as image.scan.<ext>. Calls run one at a time; the API key is read from
 * .dev.vars and never printed.
 */
import { readdir, readFile, writeFile, mkdir, access } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import type { compressReceiptPhoto as Compress } from "../src/image";
import { normalizeRawText } from "../shared/receipt-text";
import { normalizeText, trigramSimilarity } from "../shared/text";
import { createGemini } from "../worker/services/ai/gemini";
import { mergeDuplicateLines, prepareLines } from "../worker/services/scan-lines";
import type { ExtractedReceipt, ProductChoice } from "../worker/services/ai/types";
import { decide, findCandidates, matchStore, type Alias, type CatalogProduct, type CatalogStore } from "../worker/services/matching";

const ROOT = "fixtures/receipts";
const RESULTS = join(ROOT, "results");
const DEV_SERVER = "http://localhost:5173";

type ExpectedLine = { raw_text: string; price_cents: number; discount_cents: number; product: string; pieces?: number };
type Expected = { chain: string; vat_number: string | null; date: string; total_cents: number; lines: ExpectedLine[] };

const { values: args } = parseArgs({
  options: {
    model: { type: "string" },
    "no-ai-match": { type: "boolean", default: false },
    only: { type: "string" },
    yes: { type: "boolean", default: false },
  },
});

async function devVar(name: string): Promise<string | undefined> {
  const text = await readFile(".dev.vars", "utf8").catch(() => "");
  const line = text.split("\n").find((l) => l.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim().replace(/^"(.*)"$/, "$1") || undefined;
}

async function wranglerVar(name: string): Promise<string | undefined> {
  const text = await readFile("wrangler.jsonc", "utf8");
  return new RegExp(`"${name}"\\s*:\\s*"([^"]+)"`).exec(text)?.[1];
}

const exists = (p: string) => access(p).then(() => true, () => false);

/** Compressed photo, produced by the app's own compressReceiptPhoto in a real browser (EXIF rotation included). */
async function compressedPhoto(dir: string): Promise<{ data: ArrayBuffer; mimeType: string }> {
  for (const [ext, mimeType] of [["webp", "image/webp"], ["jpg", "image/jpeg"]] as const) {
    const cached = join(dir, `image.scan.${ext}`);
    if (await exists(cached)) {
      const buf = await readFile(cached);
      return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, mimeType };
    }
  }
  const source = await readFile(join(dir, "image.jpg"));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(DEV_SERVER).catch(() => {
      throw new Error(`Dev server not reachable at ${DEV_SERVER}: start it with npm run dev`);
    });
    const out = await page.evaluate(async ({ b64, module }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      // Served (and transpiled) by the Vite dev server: the exact code the phone runs.
      const { compressReceiptPhoto } = (await import(/* @vite-ignore */ module)) as { compressReceiptPhoto: typeof Compress };
      const blob = await compressReceiptPhoto(new Blob([bytes], { type: "image/jpeg" }));
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { b64: btoa(bin), type: blob.type };
    }, { b64: source.toString("base64"), module: "/src/image.ts" });
    const buf = Buffer.from(out.b64, "base64");
    await writeFile(join(dir, `image.scan.${out.type === "image/webp" ? "webp" : "jpg"}`), buf);
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, mimeType: out.type };
  } finally {
    await browser.close();
  }
}

const textSim = (a: string, b: string) => trigramSimilarity(normalizeText(normalizeRawText(a)), normalizeText(normalizeRawText(b)));

/** Pairs extracted lines with expected ones: same price + most similar text first, then text alone (price wrong). */
function alignLines(expected: ExpectedLine[], got: ExtractedReceipt["lines"]) {
  const pairs: { e: number; g: number }[] = [];
  const usedE = new Set<number>();
  const usedG = new Set<number>();
  const pass = (accept: (e: ExpectedLine, g: ExtractedReceipt["lines"][number]) => number | null) => {
    const options: { e: number; g: number; score: number }[] = [];
    expected.forEach((e, ei) =>
      got.forEach((g, gi) => {
        if (usedE.has(ei) || usedG.has(gi)) return;
        const score = accept(e, g);
        if (score != null) options.push({ e: ei, g: gi, score: score - Math.abs(ei - gi) * 0.001 }); // keep order
      }),
    );
    for (const o of options.sort((a, b) => b.score - a.score)) {
      if (usedE.has(o.e) || usedG.has(o.g)) continue;
      usedE.add(o.e);
      usedG.add(o.g);
      pairs.push(o);
    }
  };
  pass((e, g) => (e.price_cents === g.priceCents && textSim(e.raw_text, g.rawText) >= 0.3 ? textSim(e.raw_text, g.rawText) : null));
  pass((e, g) => (textSim(e.raw_text, g.rawText) >= 0.5 ? textSim(e.raw_text, g.rawText) : null));
  return pairs.sort((a, b) => a.e - b.e);
}

const pct = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 1000) / 10);

async function main() {
  const apiKey = await devVar("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY missing from .dev.vars");
  const model = args.model ?? (await wranglerVar("GEMINI_MODEL"));
  if (!model) throw new Error("No model: pass --model or set GEMINI_MODEL in wrangler.jsonc");
  const aiMatch = !args["no-ai-match"];

  const ids = [];
  for (const id of (await readdir(ROOT)).sort()) {
    if (args.only && id !== args.only) continue;
    if ((await exists(join(ROOT, id, "image.jpg"))) && (await exists(join(ROOT, id, "expected.json")))) ids.push(id);
  }
  if (ids.length === 0) throw new Error("No fixtures with image.jpg + expected.json");
  const calls = ids.length * (aiMatch ? 2 : 1);
  // Free tier (2026-09): Flash-Lite ~500/day, Flash ~20/day. Don't spend more than about half of the smaller one.
  console.log(`Model ${model} · ${ids.length} receipts · up to ${calls} AI calls${aiMatch ? "" : " (no AI matching)"}`);
  if (calls > 10 && !args.yes) throw new Error("More than 10 calls: rerun with --yes if the daily quota allows it");

  const expectedAll = Object.fromEntries(
    await Promise.all(ids.map(async (id) => [id, JSON.parse(await readFile(join(ROOT, id, "expected.json"), "utf8")) as Expected])),
  ) as Record<string, Expected>;

  // A catalog as if every product had been entered by hand once (names only, no aliases yet), plus every store.
  const names = [...new Set(Object.values(expectedAll).flatMap((e) => e.lines.map((l) => l.product)))];
  const products: CatalogProduct[] = names.map((name, i) => ({ id: i + 1, name, brand: null }));
  const productId = (name: string) => products.find((p) => p.name === name)!.id;
  const chains = [...new Set(Object.values(expectedAll).map((e) => e.chain))];
  const stores: CatalogStore[] = Object.values(expectedAll).map((e, i) => ({
    id: i + 1,
    chainId: chains.indexOf(e.chain) + 1,
    chainName: e.chain,
    name: "Sede",
    address: null,
    vatNumber: e.vat_number,
  }));

  const ai = createGemini({ apiKey, model });
  const receipts: Awaited<ReturnType<typeof evalReceipt>>[] = [];
  for (const id of ids) receipts.push(await evalReceipt(id));

  async function evalReceipt(id: string) {
    const expected = expectedAll[id]!;
    const image = await compressedPhoto(join(ROOT, id));
    process.stdout.write(`${id} (${Math.round(image.data.byteLength / 1024)} KB ${image.mimeType}) … `);

    const t0 = performance.now();
    const raw = await ai.extract(image);
    // Same post-processing as POST /api/receipts/scan; lines are compared before merging, merging is checked apart.
    const got = { ...raw, lines: prepareLines(raw.lines) };
    const extractMs = Math.round(performance.now() - t0);
    let aiCalls = 1;

    const store = matchStore(got.store, stores);
    const chainOk = stores.find((s) => s.chainId === store.chainId)?.chainName === expected.chain;
    const pairs = alignLines(expected.lines, got.lines);

    // Matching, first scan: fuzzy on product names (+ AI second pass).
    const chainId = chains.indexOf(expected.chain) + 1;
    const found = got.lines.map((l) => findCandidates(l.rawText, chainId, products, []));
    let choices: ProductChoice[] = [];
    let matchMs = 0;
    if (aiMatch) {
      const t1 = performance.now();
      choices = await ai.chooseProducts({
        chain: expected.chain,
        lines: found.map((f, index) => ({
          index,
          rawText: f.rawTextNorm,
          candidates: f.candidates.map((c) => ({ id: c.productId, name: products[c.productId - 1]!.name })),
        })),
      });
      matchMs = Math.round(performance.now() - t1);
      aiCalls++;
    }
    const decisions = found.map((f, i) => decide(f, aiMatch ? choices.find((c) => c.index === i) : undefined));

    // Second scan of the same receipt: aliases saved from the ground truth must match automatically.
    const aliases: Alias[] = expected.lines.map((l) => ({ chainId, rawTextNorm: normalizeRawText(l.raw_text), productId: productId(l.product) }));

    const lines = pairs.map(({ e, g }) => {
      const exp = expected.lines[e]!;
      const ext = got.lines[g]!;
      const want = productId(exp.product);
      const d = decisions[g]!;
      return {
        expected: exp.raw_text,
        got: ext.rawText,
        priceOk: ext.priceCents === exp.price_cents,
        discountOk: ext.discountCents === exp.discount_cents,
        piecesOk: ext.pieces === (exp.pieces ?? null),
        candidateRecall: found[g]!.candidates.some((c) => c.productId === want),
        aiPick: aiMatch ? (choices.find((c) => c.index === g)?.productId ?? null) === want : null,
        finalOk: d.productId === want,
        status: d.status,
        aliasOk: findCandidates(ext.rawText, chainId, products, aliases).aliasProductId === want,
      };
    });
    const n = expected.lines.length;
    const mergedKey = (l: { rawText: string; priceCents: number; pieces: number | null }) => `${normalizeRawText(l.rawText)}|${l.priceCents}|${l.pieces}`;
    const mergedGot = mergeDuplicateLines(got.lines).map(mergedKey);
    const mergedWant = mergeDuplicateLines(
      expected.lines.map((l) => ({ rawText: l.raw_text, priceCents: l.price_cents, discountCents: l.discount_cents, kind: "product" as const, pieces: l.pieces ?? null, unitPriceCents: null, amountGrams: null })),
    ).map(mergedKey);
    const count = (f: (l: (typeof lines)[number]) => boolean) => lines.filter(f).length;
    const sum = got.lines.reduce((s, l) => s + l.priceCents - l.discountCents, 0);
    const r = {
      id,
      image: { bytes: image.data.byteLength, type: image.mimeType },
      chainOk,
      storeBy: store.status,
      vatOk: got.store.vatNumber === expected.vat_number,
      store: got.store,
      dateOk: got.date === expected.date,
      date: { expected: expected.date, got: got.date },
      totalOk: got.totalCents === expected.total_cents,
      sumCheck: got.totalCents != null && sum === got.totalCents,
      /** Review screen lines (repeated items merged): same text, amount and pieces as the merged ground truth, in order. */
      mergedOk: mergedGot.join("\n") === mergedWant.join("\n"),
      mergedLines: { expected: mergedWant.length, got: mergedGot.length },
      lines: { expected: n, extracted: got.lines.length, matched: pairs.length },
      recall: pct(pairs.length, n),
      precision: pct(pairs.length, got.lines.length),
      priceExact: pct(count((l) => l.priceOk), n),
      discountOk: pct(count((l) => l.discountOk), n),
      piecesOk: pct(count((l) => l.piecesOk), n),
      candidateRecall: pct(count((l) => l.candidateRecall), n),
      aiPick: aiMatch ? pct(count((l) => l.aiPick === true), n) : null,
      productOk: pct(count((l) => l.finalOk), n),
      aliasSecondScan: pct(count((l) => l.aliasOk), n),
      statuses: Object.fromEntries(["alias", "proposed", "uncertain", "none"].map((s) => [s, decisions.filter((d) => d.status === s).length])),
      extractMs,
      matchMs,
      aiCalls,
      mismatches: lines.filter((l) => !l.priceOk || !l.finalOk || !l.aliasOk || !l.piecesOk),
      unmatchedExpected: expected.lines.filter((_, i) => !pairs.some((p) => p.e === i)).map((l) => `${l.raw_text} ${l.price_cents}`),
      extracted: raw.lines.map((l) => `${l.kind} ${l.rawText} | ${l.priceCents} | pz ${l.pieces ?? "-"} × ${l.unitPriceCents ?? "-"}`),
      unmatchedExtracted: got.lines.filter((_, i) => !pairs.some((p) => p.g === i)).map((l) => `${l.rawText} ${l.priceCents}`),
    };
    console.log(`recall ${r.recall}% · prezzi ${r.priceExact}% · pezzi ${r.piecesOk}% · unite ${r.mergedOk ? "ok" : "✗"} · prodotti ${r.productOk}% · ${extractMs + matchMs} ms`);
    return r;
  }

  const totalExpected = receipts.reduce((s, r) => s + r.lines.expected, 0);
  const weighted = (k: "recall" | "priceExact" | "discountOk" | "piecesOk" | "candidateRecall" | "aiPick" | "productOk" | "aliasSecondScan") =>
    receipts.some((r) => r[k] == null) ? null : pct(receipts.reduce((s, r) => s + (r[k]! / 100) * r.lines.expected, 0), totalExpected);
  const overall = {
    receipts: receipts.length,
    lines: totalExpected,
    chain: pct(receipts.filter((r) => r.chainOk).length, receipts.length),
    date: pct(receipts.filter((r) => r.dateOk).length, receipts.length),
    total: pct(receipts.filter((r) => r.totalOk).length, receipts.length),
    sumCheck: pct(receipts.filter((r) => r.sumCheck).length, receipts.length),
    merged: pct(receipts.filter((r) => r.mergedOk).length, receipts.length),
    recall: weighted("recall"),
    precision: pct(
      receipts.reduce((s, r) => s + r.lines.matched, 0),
      receipts.reduce((s, r) => s + r.lines.extracted, 0),
    ),
    priceExact: weighted("priceExact"),
    discountOk: weighted("discountOk"),
    piecesOk: weighted("piecesOk"),
    candidateRecall: weighted("candidateRecall"),
    aiPick: weighted("aiPick"),
    productOk: weighted("productOk"),
    aliasSecondScan: weighted("aliasSecondScan"),
    avgMs: Math.round(receipts.reduce((s, r) => s + r.extractMs + r.matchMs, 0) / receipts.length),
    aiCalls: receipts.reduce((s, r) => s + r.aiCalls, 0),
  };

  await mkdir(RESULTS, { recursive: true });
  const previous = (await readdir(RESULTS)).filter((f) => f.endsWith(".json")).sort();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = join(RESULTS, `${stamp}-gemini-${model}${aiMatch ? "" : "-noai"}.json`);
  await writeFile(file, JSON.stringify({ model, aiMatch, overall, receipts }, null, 2));
  console.log(`\nSaved ${file}`);

  // Comparison with the previous run (same fixtures or not: the file names say which).
  const last = previous.at(-1);
  const prev = last ? (JSON.parse(await readFile(join(RESULTS, last), "utf8")) as { overall: typeof overall }).overall : null;
  const higherIsBetter = new Set(Object.keys(overall).filter((k) => !["avgMs", "aiCalls", "receipts", "lines"].includes(k)));
  console.log(`\n${"metric".padEnd(16)} ${"now".padStart(8)} ${prev ? `${"prev".padStart(8)}  (${last})` : ""}`);
  for (const [k, v] of Object.entries(overall)) {
    const p = prev?.[k as keyof typeof overall];
    const worse = prev && typeof v === "number" && typeof p === "number" && higherIsBetter.has(k) && v < p;
    console.log(`${k.padEnd(16)} ${String(v).padStart(8)} ${prev ? String(p ?? "-").padStart(8) : ""}${worse ? "  ⚠ WORSE" : ""}`);
  }
  for (const r of receipts) {
    if (r.mismatches.length || r.unmatchedExpected.length || r.unmatchedExtracted.length) {
      console.log(`\n${r.id}:`);
      for (const m of r.mismatches) console.log(`  ${m.expected} ← ${m.got}: price ${m.priceOk ? "ok" : "✗"}, pieces ${m.piecesOk ? "ok" : "✗"}, product ${m.finalOk ? "ok" : "✗"} (${m.status}), alias ${m.aliasOk ? "ok" : "✗"}`);
      for (const u of r.unmatchedExpected) console.log(`  missing: ${u}`);
      for (const u of r.unmatchedExtracted) console.log(`  extra:   ${u}`);
    }
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : "eval failed");
  process.exit(1);
});
