import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { OffLookup, Product } from "../../shared/api";
import { createApp } from "../../worker/app";
import { OFF_USER_AGENT } from "../../worker/routes/off";
import { createFakeAccess } from "../helpers/access";
import { BASE, createTestApi } from "../helpers/api";
import { resetDb } from "../helpers/db";

const PASSATA = "8001234567897";

/** App with a fake Open Food Facts; records every outgoing request. */
async function appWithOff(respond: (url: string) => Response | Promise<Response>) {
  const access = await createFakeAccess();
  const requests: { url: string; headers: Headers }[] = [];
  const offFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, headers: new Headers(init?.headers) });
    return respond(url);
  }) as typeof fetch;
  const app = createApp({ keySet: access.keySet, offFetch });
  const token = await access.sign();
  const get = async (path: string, auth = true) => {
    const res = await app.request(`${BASE}${path}`, { headers: auth ? { "Cf-Access-Jwt-Assertion": token } : {} }, env);
    return { status: res.status, body: (await res.json()) as OffLookup & { message?: string } };
  };
  return { get, requests };
}

const offProduct = {
  status: 1,
  product: {
    product_name_it: "Passata di pomodoro",
    brands: "Mutti",
    product_quantity: 700,
    product_quantity_unit: "g",
    nutriments: { "energy-kcal_100g": 36, proteins_100g: 1.6, fat_100g: 0.2, carbohydrates_100g: 6.2, sugars_100g: 4.5 },
  },
};

beforeEach(resetDb);

describe("GET /api/off/:barcode", () => {
  it("returns the mapped prefill, asking OFF with an identifying User-Agent and only the needed fields", async () => {
    const { get, requests } = await appWithOff(() => Response.json(offProduct));
    const { status, body } = await get(`/api/off/${PASSATA}`);
    expect(status).toBe(200);
    expect(body).toEqual({
      existingProductId: null,
      prefill: {
        barcode: PASSATA,
        name: "Passata di pomodoro",
        brand: "Mutti",
        unit: "g",
        packageAmount: 700,
        nutrition: { kcal100: 36, protein100: 1.6, fat100: 0.2, carbs100: 6.2, sugars100: 4.5, saturatedFat100: null, fiber100: null, salt100: null },
        warnings: [],
      },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toMatch(new RegExp(`^https://world\\.openfoodfacts\\.org/api/v2/product/${PASSATA}\\.json\\?fields=`));
    expect(requests[0]!.headers.get("User-Agent")).toBe(OFF_USER_AGENT);
  });

  it("points to the product already in the catalog without calling OFF", async () => {
    const api = await createTestApi();
    const id = (await api.post<{ id: number }>("/api/products", { name: "Passata", unit: "g", barcode: PASSATA })).body.id;
    const { get, requests } = await appWithOff(() => Response.json(offProduct));
    expect((await get(`/api/off/${PASSATA}`)).body).toEqual({ existingProductId: id, prefill: null });
    expect(requests).toHaveLength(0);
  });

  it("404 for a code unknown to OFF (HTTP 404 or status 0)", async () => {
    const a = await appWithOff(() => Response.json({ status: 0, status_verbose: "product not found" }, { status: 404 }));
    expect((await a.get(`/api/off/${PASSATA}`)).status).toBe(404);
    const b = await appWithOff(() => Response.json({ status: 0 }));
    const res = await b.get(`/api/off/${PASSATA}`);
    expect(res.status).toBe(404);
    expect(res.body.message).toContain("inserisci i dati a mano");
  });

  it("502 when OFF fails or is unreachable", async () => {
    expect((await (await appWithOff(() => new Response("oops", { status: 503 }))).get(`/api/off/${PASSATA}`)).status).toBe(502);
    const down = await appWithOff(() => {
      throw new TypeError("network");
    });
    expect((await down.get(`/api/off/${PASSATA}`)).status).toBe(502);
  });

  it("502 for a redirect (never followed) or an oversized answer", async () => {
    const redirect = await appWithOff(() => new Response(null, { status: 302, headers: { Location: "https://example.com/" } }));
    expect((await redirect.get(`/api/off/${PASSATA}`)).status).toBe(502);
    expect(redirect.requests).toHaveLength(1);
    const huge = await appWithOff(() => Response.json({ status: 1, product: { product_name: "x".repeat(600 * 1024) } }));
    expect((await huge.get(`/api/off/${PASSATA}`)).status).toBe(502);
  });

  it("400 for an invalid barcode, without calling OFF", async () => {
    const { get, requests } = await appWithOff(() => Response.json(offProduct));
    for (const code of ["8001234567893", "123", "abc", "1234567890", "123456789012345"]) {
      expect((await get(`/api/off/${code}`)).status).toBe(400);
    }
    expect(requests).toHaveLength(0);
  });

  it("looks up a UPC-E code in its 13-digit form", async () => {
    const { get, requests } = await appWithOff(() => Response.json(offProduct));
    expect((await get("/api/off/04252614")).body.prefill?.barcode).toBe("0042100005264");
    expect(requests[0]!.url).toContain("/product/0042100005264.json");
  });

  it("502, not 404, for a non-JSON answer; a clear message on OFF's rate limit", async () => {
    expect((await (await appWithOff(() => new Response("<html>maintenance</html>"))).get(`/api/off/${PASSATA}`)).status).toBe(502);
    const limited = await (await appWithOff(() => new Response("", { status: 429 }))).get(`/api/off/${PASSATA}`);
    expect(limited.status).toBe(502);
    expect(limited.body.message).toContain("Troppe richieste");
  });

  it("401 without Access", async () => {
    const { get, requests } = await appWithOff(() => Response.json(offProduct));
    expect((await get(`/api/off/${PASSATA}`, false)).status).toBe(401);
    expect(requests).toHaveLength(0);
  });
});

describe("products: barcode and nutrition source", () => {
  it("validates and cleans the barcode", async () => {
    const api = await createTestApi();
    expect((await api.post("/api/products", { name: "X", unit: "g", barcode: "8001234567893" })).status).toBe(400);
    const id = (await api.post<{ id: number }>("/api/products", { name: "X", unit: "g", barcode: "8 001234 567897" })).body.id;
    expect((await api.get<Product>(`/api/products/${id}`)).body.barcode).toBe(PASSATA);
    expect((await api.post<{ id: number }>("/api/products", { name: "Y", unit: "g", barcode: "" })).status).toBe(201);
  });

  it("stores saturated fat and fibre, validates them and keeps them on merge", async () => {
    const api = await createTestApi();
    const id = (await api.post<{ id: number }>("/api/products", { name: "Pasta integrale", unit: "g", fat100: 2.5, saturatedFat100: 0.5, fiber100: 7, salt100: 0.01 }))
      .body.id;
    expect((await api.get<Product>(`/api/products/${id}`)).body).toMatchObject({ saturatedFat100: 0.5, fiber100: 7, salt100: 0.01 });
    expect((await api.post("/api/products", { name: "X", unit: "g", salt100: 100.5 })).status).toBe(400);
    expect((await api.post("/api/products", { name: "X", unit: "g", fiber100: 101 })).status).toBe(400);
    expect((await api.post("/api/products", { name: "X", unit: "g", saturatedFat100: -1 })).status).toBe(400);
    // Merge into a product without nutrition: the source's values move over
    const target = (await api.post<{ id: number }>("/api/products", { name: "Pasta int.", unit: "g" })).body.id;
    expect((await api.post(`/api/products/${id}/merge`, { intoId: target })).status).toBe(200);
    expect((await api.get<Product>(`/api/products/${target}`)).body).toMatchObject({ fat100: 2.5, saturatedFat100: 0.5, fiber100: 7, salt100: 0.01 });
  });

  it("records an OFF import as 'off' until a value is edited by hand", async () => {
    const api = await createTestApi();
    const values = { name: "Passata", unit: "g", kcal100: 36, protein100: 1.6, fat100: 0.2, carbs100: 6.2, sugars100: 4.5 };
    const id = (await api.post<{ id: number }>("/api/products", { ...values, nutritionSource: "off" })).body.id;
    const source = async () => (await api.get<Product>(`/api/products/${id}`)).body.nutritionSource;
    expect(await source()).toBe("off");
    await api.patch(`/api/products/${id}`, { ...values, name: "Passata Mutti" }); // nutrition untouched
    expect(await source()).toBe("off");
    await api.patch(`/api/products/${id}`, { ...values, kcal100: 40 });
    expect(await source()).toBe("manual");
    // Clearing every value: no source
    await api.patch(`/api/products/${id}`, { name: "Passata", unit: "g" });
    expect(await source()).toBeNull();
    // Claiming "off" without any value records nothing
    const empty = (await api.post<{ id: number }>("/api/products", { name: "Z", unit: "g", nutritionSource: "off" })).body.id;
    expect((await api.get<Product>(`/api/products/${empty}`)).body.nutritionSource).toBeNull();
  });
});
