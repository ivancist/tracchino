import { z } from "zod";
import { isValidIsoDate } from "../../../shared/dates";

// Model output is untrusted input: everything is validated and clamped here, never used raw.

const cents = z.number().int().min(0).max(100_000_00);

export const extractedLine = z.object({
  /** "quantity": a printed "2 PZ x 1,99 EUR/PZ" row, attached to its product by the Worker (`attachQuantityLines`). */
  kind: z.enum(["product", "quantity"]).nullish().transform((v) => v ?? "product"),
  rawText: z.string().trim().min(1).max(120),
  priceCents: cents,
  discountCents: cents.nullish().transform((v) => v ?? 0),
  /** Units bought, when printed: a quantity row "2 PZ x 1,99 EUR/PZ", or "2 X 1,29" on the product line → 2. */
  quantity: z.number().int().positive().max(999).nullish().transform((v) => v ?? null),
  /** Unit price of that quantity ("1,99 EUR/PZ" → 199): lets the Worker check which product the quantity belongs to. */
  unitPriceCents: cents.nullish().transform((v) => v || null),
  amountGrams: z.number().int().positive().max(100_000).nullish().transform((v) => v ?? null),
});

export const extractedReceipt = z.object({
  store: z.object({
    name: z.string().trim().max(120).nullish().transform((v) => v || null),
    address: z.string().trim().max(200).nullish().transform((v) => v || null),
    vatNumber: z.string().trim().max(20).nullish().transform((v) => v?.replace(/\D/g, "") || null),
  }),
  date: z.string().nullish().transform((v) => (v && isValidIsoDate(v) ? v : null)),
  totalCents: cents.nullish().transform((v) => v ?? null),
  lines: z.array(extractedLine).max(300),
});
export type ExtractedReceipt = z.output<typeof extractedReceipt>;
export type ExtractedLine = z.output<typeof extractedLine>;

export const productChoices = z.object({
  choices: z.array(
    z.object({
      index: z.number().int().min(0),
      productId: z.number().int().positive().nullish().transform((v) => v ?? null),
      newName: z.string().trim().max(120).nullish().transform((v) => v || null),
      confidence: z.number().min(0).max(1),
    }),
  ),
});
export type ProductChoice = z.output<typeof productChoices>["choices"][number];

export type ChoiceRequest = {
  chain: string | null;
  lines: { index: number; rawText: string; candidates: { id: number; name: string }[] }[];
};

/** A vision-capable model provider. Implementations: Gemini (default); a fake in tests. */
export interface ReceiptAi {
  readonly name: string;
  extract(image: { data: ArrayBuffer; mimeType: string }): Promise<ExtractedReceipt>;
  /** Second pass, text only: pick the right product among fuzzy candidates, or propose a new product name. */
  chooseProducts(request: ChoiceRequest): Promise<ProductChoice[]>;
}

export class AiError extends Error {}
