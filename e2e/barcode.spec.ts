import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { OffLookup, Product } from "../shared/api";

// Camera and BarcodeDetector are faked in the page; Open Food Facts is faked with page.route (no external calls).

/** A valid EAN-13 unique to this run: 12 digits + check digit. */
function ean13(seed: number): string {
  const body = `20${String(seed).padStart(10, "0").slice(-10)}`;
  const sum = body
    .split("")
    .reverse()
    .reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 3 : 1), 0);
  return `${body}${(10 - (sum % 10)) % 10}`;
}

let counter = 0;
const uniqueCode = () => ean13(Date.now() * 10 + (counter++ % 10) + Math.floor(Math.random() * 1000) * 7);

/**
 * Fake rear camera (a canvas stream) and a BarcodeDetector that "sees" `code`; or a denied camera; or, with
 * `draw`, no BarcodeDetector at all (Safari) and a real EAN-13 drawn on the camera image for zxing to decode.
 */
async function fakeCamera(page: Page, opts: { code?: string; denied?: boolean; draw?: string }) {
  await page.addInitScript(({ code, denied, draw }) => {
    // EAN-13 symbology: digit patterns L/G (left half, parity from the first digit) and R (right half)
    const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
    const R = L.map((p) => p.replace(/./g, (b) => (b === "0" ? "1" : "0")));
    const G = R.map((p) => p.split("").reverse().join(""));
    const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];
    const ean13Bits = (c: string) => {
      const d = c.split("").map(Number);
      const left = d.slice(1, 7).map((n, i) => (PARITY[d[0]!]![i] === "L" ? L : G)[n]).join("");
      return `101${left}01010${d.slice(7).map((n) => R[n]).join("")}101`;
    };
    const md = navigator.mediaDevices ?? ({} as MediaDevices);
    Object.defineProperty(navigator, "mediaDevices", { value: md, configurable: true });
    md.getUserMedia = async () => {
      if (denied) throw new DOMException("denied", "NotAllowedError");
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext("2d")!;
      if (draw) {
        canvas.width = 640;
        canvas.height = 480;
      }
      setInterval(() => {
        if (draw) {
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = "#000";
          ean13Bits(draw).split("").forEach((bit, i) => bit === "1" && ctx.fillRect(110 + i * 4, 140, 4, 200));
        } else {
          ctx.fillStyle = `hsl(${Date.now() % 360} 50% 50%)`;
          ctx.fillRect(0, 0, 320, 240);
        }
      }, 50);
      return canvas.captureStream(20);
    };
    if (draw) {
      delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
      return;
    }
    (window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = class {
      static async getSupportedFormats() {
        return ["ean_13", "ean_8", "qr_code"];
      }
      async detect() {
        return code ? [{ rawValue: code }] : [];
      }
    };
  }, opts);
}

async function fakeOff(page: Page, respond: (code: string) => { status: number; json: unknown }) {
  const calls: string[] = [];
  await page.route("**/api/off/*", async (route) => {
    const code = route.request().url().split("/").pop()!;
    calls.push(code);
    await route.fulfill(respond(code));
  });
  return calls;
}

async function createProduct(request: APIRequestContext, data: Record<string, unknown>) {
  const res = await request.post("/api/products", { data });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

async function getProduct(request: APIRequestContext, id: number) {
  return (await (await request.get(`/api/products/${id}`)).json()) as Product;
}

test("barcode di un prodotto già presente → apre il prodotto (lookup reale nel catalogo)", async ({ page, request }, info) => {
  const code = uniqueCode();
  const name = `Passata ${info.project.name} ${code}`;
  const id = await createProduct(request, { name, unit: "g", barcode: code });
  await fakeCamera(page, { code });

  await page.goto("/prodotti");
  await page.getByRole("button", { name: "📷 Barcode" }).click();
  await expect(page).toHaveURL(new RegExp(`/prodotti/${id}$`));
  await expect(page.getByRole("heading", { level: 1 })).toContainText(name);
});

test("senza BarcodeDetector (Safari iOS) il codice si legge con zxing dall'immagine della fotocamera", async ({ page, request }, info) => {
  const code = uniqueCode();
  const name = `Tonno ${info.project.name} ${code}`;
  const id = await createProduct(request, { name, unit: "g", barcode: code });
  await fakeCamera(page, { draw: code });
  const zxing: string[] = [];
  page.on("request", (r) => r.url().includes("zxing") && zxing.push(r.url()));

  await page.goto("/prodotti");
  expect(zxing).toEqual([]); // not loaded until the camera opens
  await page.getByRole("button", { name: "📷 Barcode" }).click();
  await expect(page).toHaveURL(new RegExp(`/prodotti/${id}$`), { timeout: 15_000 });
  expect(zxing.length).toBeGreaterThan(0);
});

test("barcode nuovo → prodotto precompilato da Open Food Facts, salvato con fonte OFF", async ({ page, request }, info) => {
  const code = uniqueCode();
  const name = `Nutella ${info.project.name} ${code}`;
  await fakeCamera(page, { code });
  const calls = await fakeOff(page, (c) => ({
    status: 200,
    json: {
      existingProductId: null,
      prefill: {
        barcode: c,
        name,
        brand: "Ferrero",
        unit: "g",
        packageAmount: 400,
        nutrition: { kcal100: 539, protein100: 6.3, fat100: 30.9, carbs100: 57.5, sugars100: 56.3 },
        warnings: [],
      },
    } satisfies OffLookup,
  }));

  await page.goto("/prodotti");
  await page.getByRole("button", { name: "📷 Barcode" }).click();
  await expect(page).toHaveURL(/\/prodotti\/nuovo$/);
  expect(calls).toEqual([code]);
  await expect(page.getByTestId("off-prefilled")).toBeVisible();
  await expect(page.getByLabel("Codice a barre", { exact: true })).toHaveValue(code);
  await expect(page.getByLabel("Nome")).toHaveValue(name);
  await expect(page.getByLabel("Marca")).toHaveValue("Ferrero");
  await expect(page.getByLabel("Confezione")).toHaveValue("400");
  await expect(page.getByLabel("kcal")).toHaveValue("539");
  await expect(page.getByLabel("Grassi (g)")).toHaveValue("30,9");
  await expect(page.getByText("Fonte: Open Food Facts")).toBeVisible();
  await expect(page.getByTestId("nutrition-warnings")).toBeHidden(); // 4·6,3 + 9·30,9 + 4·57,5 ≈ 533 kcal

  await page.getByRole("button", { name: "Salva prodotto" }).click();
  await expect(page).toHaveURL(/\/prodotti$/);
  const list = (await (await request.get("/api/products")).json()) as Product[];
  const saved = list.find((p) => p.barcode === code)!;
  expect(saved).toMatchObject({ name, brand: "Ferrero", packageAmount: 400, kcal100: 539, fat100: 30.9, nutritionSource: "off" });
});

test("prodotto assente da OFF: valori a mano, avviso di plausibilità, fonte manuale", async ({ page, request }, info) => {
  const code = uniqueCode();
  await fakeCamera(page, { code });
  await fakeOff(page, () => ({
    status: 404,
    json: { error: "not_found", message: "Prodotto non presente su Open Food Facts: inserisci i dati a mano" },
  }));

  await page.goto("/prodotti");
  await page.getByRole("button", { name: "📷 Barcode" }).click();
  await expect(page).toHaveURL(/\/prodotti\/nuovo$/);
  await expect(page.getByText("Prodotto non presente su Open Food Facts: inserisci i dati a mano")).toBeVisible();
  await expect(page.getByLabel("Codice a barre", { exact: true })).toHaveValue(code);

  const name = `Taralli ${info.project.name} ${code}`;
  await page.getByLabel("Nome").fill(name);
  await page.getByText("Valori nutrizionali").click();
  await page.getByLabel("Proteine (g)").fill("10");
  await page.getByLabel("Grassi (g)").fill("20");
  await page.getByLabel("Carboidrati (g)").fill("60");
  await page.getByLabel("kcal").fill("200"); // 4·10 + 9·20 + 4·60 = 460
  await expect(page.getByTestId("nutrition-warnings")).toHaveText("Le kcal (200) non tornano con i macronutrienti (≈ 460 kcal)");
  await page.getByLabel("kcal").fill("470");
  await expect(page.getByTestId("nutrition-warnings")).toBeHidden();
  await page.getByLabel("di cui zuccheri (g)").fill("70");
  await expect(page.getByTestId("nutrition-warnings")).toHaveText("Gli zuccheri superano i carboidrati");
  await page.getByLabel("di cui zuccheri (g)").fill("3,5");

  await page.getByRole("button", { name: "Salva prodotto" }).click();
  await expect(page).toHaveURL(/\/prodotti$/);
  const list = (await (await request.get("/api/products")).json()) as Product[];
  expect(list.find((p) => p.barcode === code)).toMatchObject({ name, kcal100: 470, sugars100: 3.5, nutritionSource: "manual" });
});

test("fotocamera negata: si digita il codice; codice già presente → «Usa» quel prodotto", async ({ page, request }, info) => {
  const code = uniqueCode();
  const name = `Ceci ${info.project.name} ${code}`;
  const id = await createProduct(request, { name, unit: "g", barcode: code });
  await fakeCamera(page, { denied: true });

  await page.goto("/prodotti/nuovo");
  await page.getByRole("button", { name: "📷 Scansiona" }).click();
  const dialog = page.getByRole("dialog", { name: "Scansiona codice a barre" });
  await expect(dialog.getByText("Permesso per la fotocamera negato")).toBeVisible();
  await dialog.getByLabel("Oppure digita il codice").fill("8001234567893"); // wrong check digit
  await dialog.getByRole("button", { name: "Usa questo codice" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Codice non valido");
  await dialog.getByLabel("Oppure digita il codice").fill(code.replace(/(\d{1})(\d{6})/, "$1 $2 "));
  await dialog.getByRole("button", { name: "Usa questo codice" }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByTestId("barcode-existing")).toContainText(name);
  await page.getByRole("button", { name: `Usa «${name}»` }).click();
  await expect(page).toHaveURL(new RegExp(`/prodotti/${id}$`));
  expect((await getProduct(request, id)).barcode).toBe(code);
});

test("modifica a mano dei valori importati → la fonte diventa manuale", async ({ page, request }, info) => {
  const code = uniqueCode();
  await fakeCamera(page, { code });
  await fakeOff(page, (c) => ({
    status: 200,
    json: {
      existingProductId: null,
      prefill: {
        barcode: c,
        name: `Latte ${info.project.name} ${c}`,
        brand: null,
        unit: "ml",
        packageAmount: 1000,
        nutrition: { kcal100: 46, protein100: 3.3, fat100: 1.6, carbs100: 4.9, sugars100: 4.9 },
        warnings: [],
      },
    } satisfies OffLookup,
  }));
  await page.goto("/prodotti/nuovo");
  await page.getByRole("button", { name: "📷 Scansiona" }).click();
  await expect(page.getByLabel("Confezione")).toHaveValue("1000");
  await expect(page.getByLabel("Come lo compri")).toHaveValue("ml");
  await page.getByLabel("kcal").fill("47");
  await expect(page.getByText("Fonte: modificati a mano")).toBeVisible();
  await page.getByRole("button", { name: "Salva prodotto" }).click();
  await expect(page).toHaveURL(/\/prodotti$/);
  const list = (await (await request.get("/api/products")).json()) as Product[];
  expect(list.find((p) => p.barcode === code)).toMatchObject({ unit: "ml", kcal100: 47, nutritionSource: "manual" });
});

test("dalla riga dello scontrino: un barcode già noto nel nuovo prodotto → «Usa» assegna quel prodotto alla riga", async ({ page, request }, info) => {
  const code = uniqueCode();
  const name = `Fagioli ${info.project.name} ${code}`;
  const id = await createProduct(request, { name, unit: "g", barcode: code });
  await fakeCamera(page, { code });

  await page.goto("/scontrini/nuovo");
  await page.getByLabel("Prodotto riga 1").fill(`FAGIOLI BORLOTTI ${code}`);
  await page.getByRole("option", { name: /^\+ Crea/ }).click();
  const dialog = page.getByRole("dialog", { name: "Nuovo prodotto" });
  await dialog.getByRole("button", { name: "📷 Scansiona" }).click();
  await expect(dialog.getByTestId("barcode-existing")).toContainText(name);
  await dialog.getByRole("button", { name: `Usa «${name}»` }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("Prodotto riga 1")).toHaveValue(new RegExp(name));
  // Nothing new was created
  const list = (await (await request.get("/api/products")).json()) as Product[];
  expect(list.filter((p) => p.name.includes(code)).map((p) => p.id)).toEqual([id]);
});
