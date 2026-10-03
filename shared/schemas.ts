import { z } from "zod";
import { cleanBarcode, isValidGtin, normalizeGtin } from "./barcode";
import { isValidIsoDate } from "./dates";
import { COST_MODES, COST_WINDOW_DAYS, MEALS } from "./diary";
import { PRODUCT_UNITS } from "./types";

// Input schemas for every API body. The UI uses the same schemas before sending.

/** Optional text: trimmed, empty → null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((s) => (s ? s : null));

const requiredText = (max: number) => z.string().trim().min(1, "Obbligatorio").max(max);

const positiveInt = z.number().int().positive();
const optionalPositiveInt = positiveInt.nullish().transform((v) => v ?? null);
const cents = z.number().int().min(0).max(100_000_00);

export const idParam = z.coerce.number().int().positive();

export const isoDate = z.string().refine(isValidIsoDate, "Data non valida (AAAA-MM-GG)");

export const chainInput = z.object({ name: requiredText(80) });
export type ChainInput = z.input<typeof chainInput>;

export const storeInput = z.object({
  chainId: positiveInt,
  name: requiredText(120),
  address: optionalText(200),
  vatNumber: optionalText(20),
});
export type StoreInput = z.input<typeof storeInput>;

export const groupInput = z.object({ name: requiredText(80) });
export type GroupInput = z.input<typeof groupInput>;

const per100 = (max: number) => z.number().min(0).max(max).nullish().transform((v) => v ?? null);

const BARCODE_MESSAGE = "Codice a barre non valido (controlla le cifre)";

/** A scanned or typed EAN/UPC code: digits only, valid check digit, canonical form (UPC-E expanded). */
export const barcodeCode = z.string().transform(cleanBarcode).refine(isValidGtin, BARCODE_MESSAGE).transform(normalizeGtin);

/** Product barcode: like `barcodeCode`, but optional (empty → null). */
export const barcode = z
  .string()
  .nullish()
  .transform((s) => (s ? cleanBarcode(s) : ""))
  .refine((s) => s === "" || isValidGtin(s), BARCODE_MESSAGE)
  .transform((s) => (s ? normalizeGtin(s) : null));

export const productInput = z.object({
  name: requiredText(120),
  brand: optionalText(80),
  groupId: optionalPositiveInt,
  barcode,
  unit: z.enum(PRODUCT_UNITS),
  packageAmount: optionalPositiveInt,
  avgPieceAmount: optionalPositiveInt,
  kcal100: per100(900),
  protein100: per100(100),
  fat100: per100(100),
  carbs100: per100(100),
  sugars100: per100(100),
  saturatedFat100: per100(100),
  fiber100: per100(100),
  salt100: per100(100),
  /**
   * "off": the values are an untouched Open Food Facts import (the client says so; it's a provenance label, not a
   * security property). Anything else is recorded as typed by hand.
   */
  nutritionSource: z.enum(["off", "manual"]).nullish().transform((v) => v ?? null),
});
export type ProductInput = z.input<typeof productInput>;

export const mergeInput = z.object({ intoId: positiveInt });

export const receiptItemInput = z
  .object({
    productId: positiveInt,
    rawText: optionalText(120),
    pieces: optionalPositiveInt,
    amount: optionalPositiveInt,
    priceFullCents: cents,
    discountCents: cents.default(0),
  })
  .refine((i) => i.discountCents <= i.priceFullCents, {
    message: "Lo sconto supera il prezzo",
    path: ["discountCents"],
  });
export type ReceiptItemInput = z.input<typeof receiptItemInput>;

export const receiptInput = z.object({
  storeId: positiveInt,
  date: isoDate,
  totalPrintedCents: cents.nullish().transform((v) => v ?? null),
  notes: optionalText(500),
  /** "scan": lines carry the printed text, which becomes a per-chain alias on save. */
  source: z.enum(["manual", "scan"]).default("manual"),
  items: z.array(receiptItemInput).min(1, "Aggiungi almeno un prodotto").max(300),
});
export type ReceiptInput = z.input<typeof receiptInput>;

/** A saved serving of a product: "1 banana" = 120 g, "1 vasetto" = 125 g. */
export const portionInput = z.object({
  name: requiredText(60),
  amount: positiveInt.max(100_000, "Quantità troppo grande"),
});
export type PortionInput = z.input<typeof portionInput>;

/** What was eaten: grams/ml directly, or a saved portion × quantity (exactly one of the two). */
export const diaryEntryInput = z
  .object({
    date: isoDate,
    meal: z.enum(MEALS),
    productId: positiveInt,
    amount: positiveInt.max(100_000, "Quantità troppo grande").nullish().transform((v) => v ?? null),
    portionId: optionalPositiveInt,
    portionQty: z.number().positive("La quantità deve essere maggiore di 0").max(100).nullish().transform((v) => v ?? null),
  })
  .refine((e) => (e.amount != null) !== (e.portionId != null), {
    message: "Indica i grammi oppure una porzione",
    path: ["amount"],
  })
  .refine((e) => (e.portionId == null) === (e.portionQty == null), {
    message: "Indica quante porzioni",
    path: ["portionQty"],
  });
export type DiaryEntryInput = z.input<typeof diaryEntryInput>;

/** Several entries at once (repeating a past meal): all valid or none saved. */
export const diaryBatchInput = z.object({
  entries: z.array(diaryEntryInput).min(1, "Nessuna voce da aggiungere").max(50),
});
export type DiaryBatchInput = z.input<typeof diaryBatchInput>;

/** Past meals of one kind before a day (newest first, identical ones merged). */
export const recentMealsQuery = z.object({
  meal: z.enum(MEALS),
  before: isoDate,
  limit: z.coerce.number().int().min(1).max(30).default(8),
});

export const diaryDayQuery = z.object({
  date: isoDate,
  costMode: z.enum(COST_MODES).default("average"),
  /** Days before the diary day whose purchases make the average cost. */
  windowDays: z.coerce.number().int().min(1).max(730).default(COST_WINDOW_DAYS),
});

/** Newest first; pass the last row's (date, id) as `beforeDate`/`beforeId` to get the next page. */
export const receiptListQuery = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    beforeDate: isoDate.optional(),
    beforeId: z.coerce.number().int().positive().optional(),
  })
  .refine((q) => (q.beforeDate == null) === (q.beforeId == null), { message: "beforeDate e beforeId vanno insieme" });

export const lastPricesQuery = z.object({
  excludeReceipt: z.coerce.number().int().positive().optional(),
});

export const periodQuery = z
  .object({ from: isoDate.optional(), to: isoDate.optional() })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: "La data iniziale è dopo quella finale" });

const costOptions = z.object({
  costMode: z.enum(COST_MODES).default("average"),
  windowDays: z.coerce.number().int().min(1).max(730).default(COST_WINDOW_DAYS),
});

/** Diet analysis over a period (default: from the first diary entry to today). */
export const analysisQuery = periodQuery.and(costOptions);

/** "What if": replace `fromProduct` with `toProduct` (same product = only the quantity changes) × `factor`. */
export const simulateQuery = analysisQuery.and(
  z.object({
    fromProduct: idParam,
    toProduct: idParam,
    factor: z.coerce.number().positive("Il fattore deve essere maggiore di 0").max(10).default(1),
  }),
);

export const topProductsQuery = periodQuery.and(z.object({ limit: z.coerce.number().int().min(1).max(100).default(10) }));
