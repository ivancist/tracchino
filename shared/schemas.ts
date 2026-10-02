import { z } from "zod";
import { isValidIsoDate } from "./dates";
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

export const productInput = z.object({
  name: requiredText(120),
  brand: optionalText(80),
  groupId: optionalPositiveInt,
  barcode: optionalText(32),
  unit: z.enum(PRODUCT_UNITS),
  packageAmount: optionalPositiveInt,
  avgPieceAmount: optionalPositiveInt,
  kcal100: per100(900),
  protein100: per100(100),
  fat100: per100(100),
  carbs100: per100(100),
  sugars100: per100(100),
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
  items: z.array(receiptItemInput).min(1, "Aggiungi almeno un prodotto").max(300),
});
export type ReceiptInput = z.input<typeof receiptInput>;

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

export const topProductsQuery = periodQuery.and(z.object({ limit: z.coerce.number().int().min(1).max(100).default(10) }));
