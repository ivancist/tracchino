import { Hono } from "hono";
import type { OffLookup } from "../../shared/api";
import { mapOffProduct, OFF_FIELDS, type OffRawProduct } from "../../shared/off";
import { barcodeCode } from "../../shared/schemas";
import type { AppEnv } from "../app";
import { HttpError } from "../http";

// Open Food Facts proxy (PLAN §4 Fase 4): the browser never calls OFF directly.

const OFF_ENDPOINT = "https://world.openfoodfacts.org/api/v2/product";
/** OFF asks every app to identify itself (AppName/Version + contact). The repo is public; no personal data here. */
export const OFF_USER_AGENT = "Tracchino/0.4 (personal grocery app; https://github.com/ivancist/tracchino)";
const TIMEOUT_MS = 8000;
/** A product with only the requested fields is a few KB; anything far larger is not a product answer. */
const MAX_RESPONSE_BYTES = 512 * 1024;

type OffResponse = { status?: number; product?: OffRawProduct };

function parseJson(text: string): OffResponse | null {
  try {
    return text ? (JSON.parse(text) as OffResponse) : null;
  } catch {
    return null;
  }
}

export function createOffRoutes(doFetch: typeof fetch = fetch) {
  return new Hono<AppEnv>().get("/:barcode", async (c) => {
    const parsed = barcodeCode.safeParse(c.req.param("barcode"));
    if (!parsed.success) throw new HttpError(400, { error: "invalid_input", message: parsed.error.issues[0]!.message });
    const code = parsed.data;

    // Already in the catalog: no need to ask OFF.
    const existing = await c.env.DB.prepare("select id from products where barcode = ?").bind(code).first<{ id: number }>();
    if (existing) return c.json<OffLookup>({ existingProductId: existing.id, prefill: null });

    let res: Response;
    try {
      res = await doFetch(`${OFF_ENDPOINT}/${code}.json?fields=${OFF_FIELDS.join(",")}`, {
        headers: { "User-Agent": OFF_USER_AGENT, Accept: "application/json" },
        // Never follow OFF elsewhere: a redirect is treated as an error.
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new HttpError(502, { error: "internal_error", message: "Open Food Facts non risponde, riprova o inserisci i dati a mano" });
    }
    const text = res.status >= 300 && res.status < 400 ? "" : await res.text().catch(() => "");
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new HttpError(502, { error: "internal_error", message: "Risposta di Open Food Facts inattesa" });
    }
    const body = parseJson(text);
    if (res.status === 429) {
      throw new HttpError(502, { error: "internal_error", message: "Troppe richieste a Open Food Facts: riprova tra un minuto" });
    }
    // OFF answers 404 with { status: 0 } for unknown codes. A 200 that isn't JSON is an OFF problem, not "unknown".
    if (res.status === 404 || (res.ok && body != null && (body.status === 0 || !body.product))) {
      throw new HttpError(404, { error: "not_found", message: "Prodotto non presente su Open Food Facts: inserisci i dati a mano" });
    }
    if (!res.ok || !body?.product) {
      throw new HttpError(502, { error: "internal_error", message: `Open Food Facts ha risposto con un errore (${res.status})` });
    }
    return c.json<OffLookup>({ existingProductId: null, prefill: mapOffProduct(code, body.product) });
  });
}
