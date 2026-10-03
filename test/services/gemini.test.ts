import { describe, expect, it } from "vitest";
import { createGemini } from "../../worker/services/ai/gemini";
import { AiError } from "../../worker/services/ai/types";

const receipt = {
  store: { name: "Eurospin", address: null, vatNumber: "IT 01234567890" },
  date: "2026-09-29",
  totalCents: 148,
  lines: [{ rawText: "CECI 400g", priceCents: 49, discountCents: 0, pieces: null, amountGrams: null }],
};
const ok = (json: unknown) => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }] });

/** Fake fetch answering from a queue, recording each call. */
function fakeFetch(...responses: (() => Response)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("unexpected call");
    return next();
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const image = { data: new Uint8Array([1, 2, 3]).buffer, mimeType: "image/webp" };
const gemini = (f: typeof fetch) => createGemini({ apiKey: "test-key", model: "m", fetch: f, retryDelayMs: 0 });

describe("Gemini client", () => {
  it("sends the key in a header (never in the URL) and validates the output", async () => {
    const f = fakeFetch(() => ok(receipt));
    const out = await gemini(f.fn).extract(image);
    expect(out.store.vatNumber).toBe("01234567890"); // digits only
    expect(out.lines[0]).toEqual({ kind: "product", rawText: "CECI 400g", priceCents: 49, discountCents: 0, pieces: null, unitPriceCents: null, amountGrams: null });
    expect(f.calls[0]!.url).not.toContain("test-key");
    expect((f.calls[0]!.init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
  });

  it("retries once when the model is overloaded (503)", async () => {
    const f = fakeFetch(() => new Response("", { status: 503 }), () => ok(receipt));
    await expect(gemini(f.fn).extract(image)).resolves.toMatchObject({ totalCents: 148 });
    expect(f.calls).toHaveLength(2);
  });

  it("gives up after the retry with a clear message", async () => {
    const f = fakeFetch(() => new Response("", { status: 503 }), () => new Response("", { status: 503 }));
    await expect(gemini(f.fn).extract(image)).rejects.toThrow(new AiError("Il servizio AI è sovraccarico in questo momento, riprova tra poco"));
    expect(f.calls).toHaveLength(2);
  });

  it("does not retry a quota error (429)", async () => {
    const f = fakeFetch(() => new Response("", { status: 429 }));
    await expect(gemini(f.fn).extract(image)).rejects.toThrow("Limite gratuito");
    expect(f.calls).toHaveLength(1);
  });

  it("rejects output that doesn't match the schema", async () => {
    const f = fakeFetch(() => ok({ ...receipt, lines: [{ rawText: "", priceCents: -5 }] }));
    await expect(gemini(f.fn).extract(image)).rejects.toThrow("formato inatteso");
  });

  it("drops product choices outside each line's own candidates", async () => {
    const f = fakeFetch(() =>
      ok({
        choices: [
          { index: 0, productId: 7, newName: null, confidence: 0.9 },
          { index: 1, productId: 99, newName: null, confidence: 0.9 }, // not a candidate of line 1
          { index: 2, productId: null, newName: "Ceci", confidence: 0.6 },
        ],
      }),
    );
    const choices = await gemini(f.fn).chooseProducts({
      chain: "Eurospin",
      lines: [
        { index: 0, rawText: "A", candidates: [{ id: 7, name: "x" }] },
        { index: 1, rawText: "B", candidates: [{ id: 8, name: "y" }] },
        { index: 2, rawText: "C", candidates: [] },
      ],
    });
    expect(choices.map((c) => c.index)).toEqual([0, 2]);
  });
});
