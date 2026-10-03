import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { ReceiptDetail, ScanResult } from "../../shared/api";
import { createApp } from "../../worker/app";
import { SCAN_DAILY_LIMIT } from "../../worker/routes/scan";
import { AiError, type ChoiceRequest, type ExtractedReceipt, type ReceiptAi } from "../../worker/services/ai/types";
import { createFakeAccess } from "../helpers/access";
import { BASE, createTestApi } from "../helpers/api";
import { resetDb } from "../helpers/db";

/** Deterministic stand-in for Gemini: returns a fixed extraction and records what it was asked. */
function fakeAi(extraction: ExtractedReceipt, opts: { failChoose?: boolean; choose?: (r: ChoiceRequest) => ReturnType<ReceiptAi["chooseProducts"]> } = {}) {
  const calls = { extract: 0, choose: [] as ChoiceRequest[] };
  const ai: ReceiptAi = {
    name: "fake",
    async extract() {
      calls.extract++;
      return extraction;
    },
    async chooseProducts(req) {
      calls.choose.push(req);
      if (opts.failChoose) throw new AiError("quota");
      return opts.choose ? opts.choose(req) : [];
    },
  };
  return { ai, calls };
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
const WEBP = new Uint8Array([...new TextEncoder().encode("RIFF"), 4, 0, 0, 0, ...new TextEncoder().encode("WEBP"), 1, 2]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);

async function appWith(ai: ReceiptAi | null) {
  const access = await createFakeAccess();
  const app = createApp({ keySet: access.keySet, ai: () => ai });
  const token = await access.sign();
  return async (path: string, body: BodyInit | null, contentType: string, method = "POST") => {
    const res = await app.request(
      `${BASE}${path}`,
      { method, body, headers: { "Cf-Access-Jwt-Assertion": token, "Content-Type": contentType } },
      env,
    );
    return { status: res.status, res };
  };
}

const api = await createTestApi();
let esselunga: number;
let chainId: number;
let bananas: number;
let eggs: number;

const receipt = (lines: ExtractedReceipt["lines"], store: Partial<ExtractedReceipt["store"]> = {}): ExtractedReceipt => ({
  store: { name: "ESSELUNGA S.P.A.", address: "Viale Piave 1, Milano", vatNumber: null, ...store },
  date: "2026-10-02",
  totalCents: lines.reduce((s, l) => s + l.priceCents - l.discountCents, 0),
  lines,
});
const line = (rawText: string, priceCents: number, extra: Partial<ExtractedReceipt["lines"][number]> = {}) => ({
  kind: "product" as const,
  rawText,
  priceCents,
  discountCents: 0,
  quantity: null,
  unitPriceCents: null,
  amountGrams: null,
  ...extra,
});

beforeEach(async () => {
  await resetDb();
  chainId = await api.chain("Esselunga");
  esselunga = await api.store({ chainId, name: "Viale Piave", vatNumber: "04916380159" });
  bananas = await api.product({ name: "Banane Chiquita", unit: "g", avgPieceAmount: 120 });
  eggs = await api.product({ name: "Uova fresche", unit: "pz" });
});

describe("POST /api/receipts/scan", () => {
  it("extracts, recognises the store by VAT, matches lines and reads pieces from the text", async () => {
    const { ai, calls } = fakeAi(receipt([line("BAN.CHIQ.", 179, { discountCents: 20 }), line("UOVA FRESCHE 6P", 189)], { vatNumber: "04916380159" }), {
      choose: async (r) => r.lines.map((l) => ({ index: l.index, productId: l.candidates[0]?.id ?? null, newName: null, confidence: 0.9 })),
    });
    const call = await appWith(ai);
    const { status, res } = await call("/api/receipts/scan", JPEG, "image/jpeg");
    expect(status).toBe(200);
    const scan = (await res.json()) as ScanResult;

    expect(scan.store).toMatchObject({ storeId: esselunga, status: "vat" });
    expect(scan.lines.map((l) => [l.rawTextNorm, l.productId, l.status, l.packages, l.pieces, l.discountCents])).toEqual([
      ["BAN.CHIQ", bananas, "proposed", 1, null, 20],
      ["UOVA FRESCHE 6P", eggs, "proposed", 1, 6, 0],
    ]);
    expect(scan.aiMatching).toBe(true);
    expect(calls.extract).toBe(1);
    expect(scan.scansLeft).toBe(SCAN_DAILY_LIMIT - 1);
    // Scanning stores nothing: the photo is uploaded only when the reviewed receipt is saved
    expect((await env.RECEIPT_PHOTOS.list()).objects).toHaveLength(0);
  });

  it("merges repeated lines and gives a quantity line to the product whose amount it explains", async () => {
    // Eurospin, 29/09/2026: "2 PZ x 1,99 EUR/PZ" is printed above SGOMBRI (3,98), but the model put it on the tuna above.
    const { ai, calls } = fakeAi(
      receipt([
        line("PASSATA POMOD. 700", 85),
        line("CECI 400g", 49),
        line("CECI 400g", 49),
        line("PASSATA POMOD. 700", 85),
        line("TONNO NATURALE 160", 119),
        line("TONNO NATURALE 160", 119),
        line("2 PZ x 1,99 EUR/PZ", 0, { kind: "quantity", quantity: 2, unitPriceCents: 199 }),
        line("SGOMBRI GR.NAT.120", 398),
        line("UOVA A TERRA XL 6P", 199),
      ]),
    );
    const scan = (await (await (await appWith(ai))("/api/receipts/scan", JPEG, "image/jpeg")).res.json()) as ScanResult;
    // [text, amount, packages, pieces per package]
    expect(scan.lines.map((l) => [l.rawText, l.priceCents, l.packages, l.pieces])).toEqual([
      ["PASSATA POMOD. 700", 170, 2, null],
      ["CECI 400g", 98, 2, null],
      ["TONNO NATURALE 160", 238, 2, null],
      ["SGOMBRI GR.NAT.120", 398, 2, null],
      ["UOVA A TERRA XL 6P", 199, 1, 6],
    ]);
    expect(scan.lines.reduce((s, l) => s + l.priceCents, 0)).toBe(scan.totalCents);
    expect(calls.choose[0]!.lines.map((l) => l.index)).toEqual([0, 1, 2, 3, 4]);
  });

  it("learns aliases on save: the second scan matches automatically, without asking the AI", async () => {
    const extraction = receipt([line("BAN.CHIQ.", 179)]);
    const first = fakeAi(extraction);
    const call1 = await appWith(first.ai);
    const scan1 = (await (await call1("/api/receipts/scan", JPEG, "image/jpeg")).res.json()) as ScanResult;
    expect(scan1.lines[0]!.status).not.toBe("alias");

    // The owner confirms "BAN.CHIQ." = Banane Chiquita and saves
    const saved = await api.post<{ id: number }>("/api/receipts", {
      storeId: esselunga,
      date: "2026-10-02",
      source: "scan",
      items: [{ productId: bananas, rawText: "BAN.CHIQ.", priceFullCents: 179 }],
    });
    expect(saved.status).toBe(201);
    const alias = await env.DB.prepare("select chain_id as c, raw_text_norm as raw, product_id as p, confirmations as n from product_aliases").all();
    expect(alias.results).toEqual([{ c: chainId, raw: "BAN.CHIQ", p: bananas, n: 1 }]);
    expect((await api.get<ReceiptDetail>(`/api/receipts/${saved.body.id}`)).body.source).toBe("scan");

    const second = fakeAi(receipt([line("Ban. Chiq. A", 189)]));
    const scan2 = (await (await (await appWith(second.ai))("/api/receipts/scan", JPEG, "image/jpeg")).res.json()) as ScanResult;
    expect(scan2.lines[0]).toMatchObject({ status: "alias", productId: bananas });
    expect(second.calls.choose).toHaveLength(0); // nothing left to ask
  });

  it("counts confirmations and lets a correction override an alias", async () => {
    const save = (productId: number) =>
      api.post("/api/receipts", { storeId: esselunga, date: "2026-10-02", source: "scan", items: [{ productId, rawText: "UOVA 6P", priceFullCents: 189 }] });
    await save(eggs);
    await save(eggs);
    const n = async () => (await env.DB.prepare("select product_id as p, confirmations as n from product_aliases").first())!;
    expect(await n()).toEqual({ p: eggs, n: 2 });
    await save(bananas); // corrected to another product
    expect(await n()).toEqual({ p: bananas, n: 1 });
  });

  it("falls back to text similarity when the AI second pass fails", async () => {
    const { ai } = fakeAi(receipt([line("UOVA FRESCHE 6P", 189), line("DETERSIVO PIATTI", 250)]), { failChoose: true });
    const scan = (await (await (await appWith(ai))("/api/receipts/scan", JPEG, "image/jpeg")).res.json()) as ScanResult;
    expect(scan.aiMatching).toBe(false);
    expect(scan.lines[0]).toMatchObject({ productId: eggs });
    expect(scan.lines[1]).toMatchObject({ productId: null, status: "none", suggestedName: "Detersivo Piatti" });
  });

  it("returns 502 with a readable message when extraction fails", async () => {
    const ai: ReceiptAi = { name: "broken", extract: async () => { throw new AiError("Limite gratuito del servizio AI raggiunto per oggi"); }, chooseProducts: async () => [] };
    const { status, res } = await (await appWith(ai))("/api/receipts/scan", JPEG, "image/jpeg");
    expect(status).toBe(502);
    expect(await res.json()).toMatchObject({ message: "Limite gratuito del servizio AI raggiunto per oggi" });
    // A provider failure doesn't consume the daily cap (the attempt is still counted as an AI call)
    expect(await env.DB.prepare("select scans, ai_calls as calls from ai_usage").first()).toEqual({ scans: 0, calls: 1 });
  });

  it("is disabled (503) without an AI key", async () => {
    expect((await (await appWith(null))("/api/receipts/scan", JPEG, "image/jpeg")).status).toBe(503);
  });

  it("accepts only images up to 2 MB", async () => {
    const call = await appWith(fakeAi(receipt([])).ai);
    expect((await call("/api/receipts/scan", JPEG, "text/plain")).status).toBe(415);
    expect((await call("/api/receipts/scan", JPEG, "application/json")).status).toBe(415);
    expect((await call("/api/receipts/scan", new Uint8Array(2 * 1024 * 1024 + 1), "image/jpeg")).status).toBe(413);
    // The declared type must match the bytes
    expect((await call("/api/receipts/scan", new TextEncoder().encode("<html>not an image</html>"), "image/webp")).status).toBe(415);
    expect((await call("/api/receipts/scan", WEBP, "image/jpeg")).status).toBe(415);
    expect((await call("/api/receipts/scan", JPEG, "image/png")).status).toBe(415);
    expect((await call("/api/receipts/scan", PNG, "image/jpeg")).status).toBe(415);
    expect((await call("/api/receipts/scan", new Uint8Array(0), "image/jpeg")).status).toBe(400);
  });

  it(`stops after ${SCAN_DAILY_LIMIT} scans a day (429), without calling the AI`, async () => {
    const { ai, calls } = fakeAi(receipt([]));
    const call = await appWith(ai);
    await env.DB.prepare("insert into ai_usage (day, scans) values (?, ?)")
      .bind(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date()), SCAN_DAILY_LIMIT)
      .run();
    expect((await call("/api/receipts/scan", JPEG, "image/jpeg")).status).toBe(429);
    expect(calls.extract).toBe(0);
  });

  it("clamps an AI discount larger than the price", async () => {
    const { ai } = fakeAi(receipt([line("BAN.CHIQ.", 100, { discountCents: 150 })]));
    const scan = (await (await (await appWith(ai))("/api/receipts/scan", JPEG, "image/jpeg")).res.json()) as ScanResult;
    expect(scan.lines[0]!.discountCents).toBe(100);
  });
});

describe("receipt photo (private R2)", () => {
  async function newReceipt() {
    return api.receipt({ storeId: esselunga, items: [{ productId: bananas, priceFullCents: 179 }] });
  }

  it("stores, serves and deletes the photo with the receipt", async () => {
    const call = await appWith(null);
    const id = await newReceipt();
    expect((await api.get<ReceiptDetail>(`/api/receipts/${id}`)).body.hasPhoto).toBe(false);

    expect((await call(`/api/receipts/${id}/photo`, JPEG, "image/jpeg", "PUT")).status).toBe(204);
    expect((await api.get<ReceiptDetail>(`/api/receipts/${id}`)).body.hasPhoto).toBe(true);
    const photo = await call(`/api/receipts/${id}/photo`, null, "", "GET");
    expect(photo.status).toBe(200);
    expect(photo.res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(photo.res.headers.get("Cache-Control")).toBe("private, no-cache");
    expect(new Uint8Array(await photo.res.arrayBuffer())).toEqual(JPEG);
    expect(await env.RECEIPT_PHOTOS.get(`receipts/${id}.jpg`)).not.toBeNull();

    await api.del(`/api/receipts/${id}`);
    expect(await env.RECEIPT_PHOTOS.get(`receipts/${id}.jpg`)).toBeNull();
  });

  it("replaces the photo when re-uploaded in another format", async () => {
    const call = await appWith(null);
    const id = await newReceipt();
    await call(`/api/receipts/${id}/photo`, JPEG, "image/jpeg", "PUT");
    await call(`/api/receipts/${id}/photo`, WEBP, "image/webp", "PUT");
    expect(await env.RECEIPT_PHOTOS.get(`receipts/${id}.jpg`)).toBeNull();
    expect(await env.RECEIPT_PHOTOS.get(`receipts/${id}.webp`)).not.toBeNull();
  });

  it("404s for a missing receipt or photo, 401 without auth", async () => {
    const call = await appWith(null);
    expect((await call("/api/receipts/999/photo", JPEG, "image/jpeg", "PUT")).status).toBe(404);
    const id = await newReceipt();
    expect((await call(`/api/receipts/${id}/photo`, null, "", "GET")).status).toBe(404);
    expect((await api.call("GET", `/api/receipts/${id}/photo`, undefined, { auth: false })).status).toBe(401);
  });
});
