import { z } from "zod";
import { isValidIsoDate } from "../../../shared/dates";

// Model output is untrusted input: everything is validated and clamped here, never used raw.

const cents = z.number().int().min(0).max(100_000_00);

export const extractedLine = z.object({
  rawText: z.string().trim().min(1).max(120),
  priceCents: cents,
  discountCents: cents.nullish().transform((v) => v ?? 0),
  pieces: z.number().int().positive().max(999).nullish().transform((v) => v ?? null),
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
