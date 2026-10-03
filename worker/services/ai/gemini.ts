import type { z } from "zod";
import {
  AiError,
  extractedReceipt,
  productChoices,
  type ChoiceRequest,
  type ExtractedReceipt,
  type ProductChoice,
  type ReceiptAi,
} from "./types";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = 45_000;
/** Gemini answers 500/503 when overloaded, usually for a moment: one retry after a short pause. */
const RETRY_STATUSES = new Set([500, 503]);

export const EXTRACT_PROMPT = `Sei un sistema di estrazione dati da scontrini di supermercati italiani.
Leggi lo scontrino nella foto e restituisci SOLO dati stampati sullo scontrino, senza inventare nulla.

- store.name: insegna del negozio (es. "Esselunga", "Coop", "Lidl"); store.address: indirizzo; store.vatNumber: partita IVA (solo cifre). null se non leggibili.
- date: data dello scontrino in formato AAAA-MM-GG. Sugli scontrini italiani è GG/MM/AA o GG/MM/AAAA: "29/09/26" → "2026-09-29". null se non leggibile.
- totalCents: totale pagato (riga "TOTALE" / "TOTALE COMPLESSIVO"), in centesimi di euro.
- lines: una voce per ogni prodotto acquistato e per ogni riga di quantità, nell'ordine dello scontrino:
  - rawText: la descrizione copiata carattere per carattere come stampata, abbreviazioni e spazi compresi. Non correggere e non
    completare le parole tronche ("500m" resta "500m", "POMOD." resta "POMOD."). SENZA prezzo, SENZA aliquota/codice IVA o
    reparto finale e SENZA simboli iniziali che non fanno parte della descrizione (es. "*" che segnala una promozione).
  - priceCents: importo stampato sulla riga, in centesimi (prezzo pieno, prima degli sconti).
  - discountCents: se subito dopo il prodotto c'è una riga di sconto (SCONTO, PROMO, OFFERTA, importo negativo come "-0,50"), metti qui l'importo POSITIVO dello sconto e NON creare una voce separata. Altrimenti 0.
  - kind: "product" per un prodotto. "quantity" per una riga di quantità senza descrizione del prodotto (es. "2 PZ x 1,99 EUR/PZ",
    "3 X 0,89"): trascrivila come voce a sé, nella sua posizione, con rawText = il testo della riga, priceCents = 0,
    quantity = numero di unità, unitPriceCents = prezzo unitario. Non spostare gli importi: ogni importo resta alla riga su
    cui è stampato (la riga di quantità di solito non ha importo).
  - quantity: per un prodotto, numero di unità solo se stampato nella sua riga come moltiplicazione (es. "YOGURT 2 X 0,79" → 2,
    con unitPriceCents = 79). Il numero di pezzi nella descrizione ("UOVA 6P", "X4") NON è una quantità: resta nel rawText.
    Altrimenti null.
  - unitPriceCents: prezzo unitario della quantità ("1,99 EUR/PZ" → 199). Altrimenti null.
  - Ogni riga stampata è una voce, anche se uguale a un'altra (due "CECI 400g" = due voci).
  - amountGrams: peso solo se stampato (es. "0,856 kg x 1,99 €/kg" → 856). Altrimenti null.
- Escludi righe che non sono prodotti: subtotali, totale, IVA, pagamento, resto, punti fedeltà, buoni.
- Gli importi sono interi in centesimi: "1,79" → 179.`;

const RECEIPT_SCHEMA = {
  type: "object",
  properties: {
    store: {
      type: "object",
      properties: {
        name: { type: "string", nullable: true },
        address: { type: "string", nullable: true },
        vatNumber: { type: "string", nullable: true },
      },
      required: ["name", "address", "vatNumber"],
    },
    date: { type: "string", nullable: true },
    totalCents: { type: "integer", nullable: true },
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["product", "quantity"] },
          rawText: { type: "string" },
          priceCents: { type: "integer" },
          discountCents: { type: "integer" },
          quantity: { type: "integer", nullable: true },
          unitPriceCents: { type: "integer", nullable: true },
          amountGrams: { type: "integer", nullable: true },
        },
        required: ["kind", "rawText", "priceCents", "discountCents", "quantity", "unitPriceCents", "amountGrams"],
      },
    },
  },
  required: ["store", "date", "totalCents", "lines"],
};

const CHOICE_SCHEMA = {
  type: "object",
  properties: {
    choices: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          productId: { type: "integer", nullable: true },
          newName: { type: "string", nullable: true },
          confidence: { type: "number" },
        },
        required: ["index", "productId", "newName", "confidence"],
      },
    },
  },
  required: ["choices"],
};

function choicePrompt(req: ChoiceRequest): string {
  return `Abbina le righe di uno scontrino${req.chain ? ` di ${req.chain}` : ""} ai prodotti del catalogo personale.
Le descrizioni sono abbreviate (es. "BAN.CHIQ." = "Banane Chiquita").
Per ogni riga scegli productId SOLO tra i suoi candidati, se sei ragionevolmente sicuro che sia lo stesso prodotto
(marca e tipo compatibili). Altrimenti productId = null e in newName proponi un nome leggibile in italiano per un nuovo
prodotto (es. "Banane Chiquita"). confidence: tra 0 e 1.

${JSON.stringify(req.lines)}`;
}

function toBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function createGemini(opts: { apiKey: string; model: string; fetch?: typeof fetch; retryDelayMs?: number }): ReceiptAi {
  const doFetch = opts.fetch ?? fetch;
  const retryDelayMs = opts.retryDelayMs ?? 1500;

  async function generate<S extends z.ZodType>(parts: unknown[], schema: object, validator: S): Promise<z.output<S>> {
    const body = JSON.stringify({
      contents: [{ parts }],
      generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0 },
    });
    let res: Response | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, retryDelayMs));
      try {
        res = await doFetch(`${ENDPOINT}/${encodeURIComponent(opts.model)}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": opts.apiKey },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        throw new AiError("Il servizio AI non risponde, riprova");
      }
      if (!RETRY_STATUSES.has(res.status)) break;
    }
    res = res!;
    if (res.status === 503) throw new AiError("Il servizio AI è sovraccarico in questo momento, riprova tra poco");
    if (res.status === 429) throw new AiError("Limite gratuito del servizio AI raggiunto per oggi");
    if (!res.ok) throw new AiError(`Il servizio AI ha risposto con un errore (${res.status})`);

    const data = (await res.json().catch(() => null)) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    } | null;
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new AiError("Risposta AI non leggibile");
    }
    const parsed = validator.safeParse(json);
    if (!parsed.success) throw new AiError("Risposta AI in un formato inatteso");
    return parsed.data;
  }

  return {
    name: `gemini:${opts.model}`,
    async extract(image): Promise<ExtractedReceipt> {
      return generate(
        [{ inline_data: { mime_type: image.mimeType, data: toBase64(image.data) } }, { text: EXTRACT_PROMPT }],
        RECEIPT_SCHEMA,
        extractedReceipt,
      );
    },
    async chooseProducts(req): Promise<ProductChoice[]> {
      if (req.lines.length === 0) return [];
      const { choices } = await generate([{ text: choicePrompt(req) }], CHOICE_SCHEMA, productChoices);
      // Never trust an id outside the line's own candidates.
      return choices.filter((c) => {
        const line = req.lines.find((l) => l.index === c.index);
        return line && (c.productId == null || line.candidates.some((cand) => cand.id === c.productId));
      });
    },
  };
}
