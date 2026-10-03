import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { ReceiptDetail, ReceiptSummary, ScanResult } from "../shared/api";
import { todayRome } from "../shared/dates";

// The scan endpoint is faked with page.route: no Gemini call, no quota used. Photo upload and save hit the real
// local Worker (D1 + R2).

const euro = (s: string) => new RegExp(`${s}\\s€`);
const MAX_PHOTO_BYTES = 300 * 1024;

async function seed(request: APIRequestContext, tag: string) {
  const post = async (path: string, data: unknown) => {
    const res = await request.post(path, { data });
    expect(res.status(), `${path}: ${await res.text()}`).toBe(201);
    return ((await res.json()) as { id: number }).id;
  };
  const milk = await post("/api/products", { name: `Latte ${tag}`, unit: "ml", packageAmount: 1000 });
  const bananas = await post("/api/products", { name: `Banane ${tag}`, unit: "g", avgPieceAmount: 120 });
  const bread = await post("/api/products", { name: `Pane ${tag}`, unit: "g" });
  return { milk, bananas, bread };
}

function fixture(tag: string, vat: string, ids: Awaited<ReturnType<typeof seed>>): ScanResult {
  const line = (l: Partial<ScanResult["lines"][number]> & Pick<ScanResult["lines"][number], "rawText" | "priceCents" | "status">) => ({
    rawTextNorm: l.rawText,
    discountCents: 0,
    pieces: null,
    amount: null,
    productId: null,
    candidates: [],
    suggestedName: null,
    ...l,
  });
  return {
    model: "fake",
    aiMatching: true,
    store: { name: `E2E Scan ${tag}`, address: "Via Roma 1, Torino", vatNumber: vat, storeId: null, status: "none" },
    date: todayRome(), // newest first: today's receipt is on the first page of the list
    totalCents: 149 + 120 + 250 - 50 + 199,
    lines: [
      line({ rawText: "LATTE INT 1L", priceCents: 149, status: "alias", productId: ids.milk }),
      line({ rawText: "BANANE", priceCents: 120, status: "proposed", productId: ids.bananas, amount: 856 }),
      line({ rawText: "PANE ARAB", priceCents: 250, discountCents: 50, status: "uncertain", productId: ids.bread }),
      line({ rawText: "UOVA XL 6P", priceCents: 199, status: "none", pieces: 6, suggestedName: `Uova ${tag}` }),
    ],
    scansLeft: 29,
  };
}

/** A synthetic phone-sized "receipt" photo (lines of text + sensor noise), generated in the page as a JPEG. */
async function syntheticPhoto(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 3024;
    canvas.height = 4032;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#e8e2d4";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#1a1a1a";
    ctx.font = "64px monospace";
    for (let y = 120; y < canvas.height; y += 90) ctx.fillText(`PRODOTTO ${y} ............ ${(y % 997) / 100} EUR`, 300, y);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 30;
      img.data[i] = img.data[i]! + n;
      img.data[i + 1] = img.data[i + 1]! + n;
      img.data[i + 2] = img.data[i + 2]! + n;
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.92);
  });
  return Buffer.from(dataUrl.split(",")[1]!, "base64");
}

async function startScan(page: Page, result: ScanResult) {
  const scanned: { type: string; bytes: number }[] = [];
  await page.route("**/api/receipts/scan", async (route) => {
    const req = route.request();
    scanned.push({ type: req.headers()["content-type"] ?? "", bytes: req.postDataBuffer()?.length ?? 0 });
    await route.fulfill({ json: result });
  });
  await page.goto("/");
  const photo = await syntheticPhoto(page);
  expect(photo.length).toBeGreaterThan(MAX_PHOTO_BYTES); // compression must actually do something
  await page.getByLabel("Foto dello scontrino").setInputFiles({ name: "scontrino.jpg", mimeType: "image/jpeg", buffer: photo });
  await expect(page).toHaveURL(/\/scontrini\/scansione$/);
  expect(scanned).toHaveLength(1);
  expect(scanned[0]!.type).toMatch(/^image\/(webp|jpeg)$/);
  expect(scanned[0]!.bytes).toBeGreaterThan(0);
  expect(scanned[0]!.bytes).toBeLessThanOrEqual(MAX_PHOTO_BYTES);
}

test("scansione: revisione con stati, conferma obbligatoria, nuovo negozio e prodotto, foto salvata", async ({ page, request }, info) => {
  const tag = `${Date.now().toString(36)}${info.project.name}`;
  const vat = String(Date.now()).slice(-11);
  const ids = await seed(request, tag);
  await startScan(page, fixture(tag, vat, ids));

  const lines = page.getByTestId("receipt-line");
  await expect(lines).toHaveCount(4);
  const statuses = page.getByTestId("match-status");
  await expect(statuses).toHaveText(["Riconosciuto", "Proposto", "Incerto", "Nuovo prodotto"]);
  await expect(lines.nth(0)).toContainText("Sullo scontrino: LATTE INT 1L");
  await expect(page.getByLabel("Pezzi riga 4")).toHaveValue("6");
  await expect(page.getByLabel("Quantità riga 2")).toHaveValue("856");
  await expect(page.getByLabel("Sconto riga 3")).toHaveValue("0,50");
  // Only complete lines count: the unconfirmed uncertain line and the new-product line are excluded.
  await expect(page.getByTestId("receipt-total")).toHaveText(euro("2,69"));
  await expect(page.getByTestId("receipt-total-warning")).toHaveText("2 righe incomplete escluse");

  // Unknown store: never defaulted silently.
  await expect(page.getByTestId("store-unknown")).toContainText(`E2E Scan ${tag}`);
  await page.getByRole("button", { name: "Salva", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Scegli il negozio");

  // Store form prefilled from the receipt (new chain, address, VAT).
  await page.getByRole("button", { name: "Crea negozio" }).click();
  const storeDialog = page.getByRole("dialog", { name: "Nuovo negozio" });
  await expect(storeDialog.getByLabel("Nome della catena")).toHaveValue(`E2E Scan ${tag}`);
  await expect(storeDialog.getByLabel("Punto vendita")).toHaveValue("Via Roma 1, Torino");
  await expect(storeDialog.getByLabel("Partita IVA")).toHaveValue(vat);
  await storeDialog.getByRole("button", { name: "Salva negozio" }).click();
  await expect(storeDialog).toBeHidden();
  await expect(page.getByTestId("store-unknown")).toBeHidden();

  // The uncertain line blocks saving until confirmed.
  await page.getByRole("button", { name: "Salva", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Correggi le righe evidenziate");
  await expect(lines.nth(2)).toContainText("Conferma il prodotto proposto o scegline un altro");
  await page.getByRole("button", { name: "Confermo il prodotto della riga 3" }).click();
  await expect(statuses.nth(2)).toHaveText("Confermato");

  // New product: created from the suggested name.
  await page.getByRole("button", { name: `Crea «Uova ${tag}»` }).click();
  const productDialog = page.getByRole("dialog", { name: "Nuovo prodotto" });
  await expect(productDialog.getByLabel("Nome")).toHaveValue(`Uova ${tag}`);
  await productDialog.getByRole("button", { name: /Salva/ }).click();
  await expect(productDialog).toBeHidden();
  await expect(statuses.nth(3)).toHaveText("Confermato");
  await expect(page.getByTestId("receipt-total")).toHaveText(euro("6,68"));
  await expect(page.getByTestId("sum-mismatch")).toBeHidden(); // Σ lines − discounts == printed total

  const photoUpload = page.waitForRequest((r) => r.method() === "PUT" && /\/api\/receipts\/\d+\/photo$/.test(r.url()));
  await page.getByRole("button", { name: "Salva", exact: true }).click();
  const uploaded = await photoUpload;
  expect(uploaded.headers()["content-type"]).toMatch(/^image\/(webp|jpeg)$/);
  expect(uploaded.postDataBuffer()!.length).toBeLessThanOrEqual(MAX_PHOTO_BYTES);
  await expect(page).toHaveURL(/\/$/);

  const list = (await (await request.get("/api/receipts?limit=50")).json()) as ReceiptSummary[];
  const saved = list.find((r) => r.chainName === `E2E Scan ${tag}`);
  expect(saved).toMatchObject({ source: "scan", totalCents: 668, totalPrintedCents: 668, date: todayRome() });
  const detail = (await (await request.get(`/api/receipts/${saved!.id}`)).json()) as ReceiptDetail;
  expect(detail.hasPhoto).toBe(true);
  expect(detail.items.map((i) => [i.rawText, i.productId])).toEqual([
    ["LATTE INT 1L", ids.milk],
    ["BANANE", ids.bananas],
    ["PANE ARAB", ids.bread],
    ["UOVA XL 6P", expect.any(Number)],
  ]);
  expect(detail.items[3]).toMatchObject({ pieces: 6, productName: `Uova ${tag}` });
  const photo = await request.get(`/api/receipts/${saved!.id}/photo`);
  expect(photo.status()).toBe(200);
  expect(photo.headers()["content-type"]).toBe(uploaded.headers()["content-type"]);

  // The saved receipt shows its photo.
  await page.goto(`/scontrini/${saved!.id}`);
  await page.getByText("Foto dello scontrino").click();
  await expect(page.getByAltText("Foto dello scontrino")).toBeVisible();
  await expect(page.getByText("Sostituisci foto")).toBeVisible();
});

test("scansione: se l'invio della foto fallisce lo scontrino resta salvato e la foto si può ricaricare", async ({ page, request }, info) => {
  const tag = `${Date.now().toString(36)}${info.project.name}`;
  const ids = await seed(request, tag);
  const chainId = ((await (await request.post("/api/chains", { data: { name: `E2E Scan ${tag}` } })).json()) as { id: number }).id;
  const vat = String(Date.now() + 7).slice(-11);
  const storeId = ((await (await request.post("/api/stores", { data: { chainId, name: "Sede", vatNumber: vat } })).json()) as { id: number }).id;
  const result = fixture(tag, vat, ids);
  result.store = { ...result.store, storeId, status: "vat" };
  result.lines = result.lines.slice(0, 2);
  result.totalCents = 269;
  result.date = null; // unreadable: defaults to today, flagged

  await page.route(/\/api\/receipts\/\d+\/photo$/, (route) =>
    route.request().method() === "PUT" ? route.fulfill({ status: 500, json: { error: "internal_error", message: "boom" } }) : route.fallback(),
  );
  await startScan(page, result);
  await expect(page.getByTestId("store-unknown")).toBeHidden();
  await expect(page.getByText("Data non leggibile sullo scontrino: controllala.")).toBeVisible();
  await expect(page.getByLabel("Data")).toHaveValue(todayRome());
  await page.getByRole("button", { name: "Salva", exact: true }).click();

  await expect(page).toHaveURL(/\/scontrini\/\d+$/);
  await expect(page.getByRole("alert")).toContainText("Scontrino salvato, ma la foto non è stata caricata");
  await page.unroute(/\/api\/receipts\/\d+\/photo$/);
  const photo = await syntheticPhoto(page);
  await page.getByLabel("Foto dello scontrino").setInputFiles({ name: "scontrino.jpg", mimeType: "image/jpeg", buffer: photo });
  await expect(page.getByText("Sostituisci foto")).toBeVisible();
  const id = Number(page.url().split("/").pop());
  expect((await request.get(`/api/receipts/${id}/photo`)).status()).toBe(200);
});

test("scansione: dopo un ricaricamento la revisione non è più disponibile", async ({ page }) => {
  await page.goto("/scontrini/scansione");
  await expect(page.getByText("La scansione non è più disponibile")).toBeVisible();
});
