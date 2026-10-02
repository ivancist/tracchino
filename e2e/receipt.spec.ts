import { expect, test, type Page } from "@playwright/test";

// Local D1 persists between runs: every name is unique per run, and the receipt is deleted at the end.
const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const euro = (s: string) => new RegExp(`${s}\\s€`);

async function createProductFromLine(page: Page, line: number, name: string, fill: (dialog: ReturnType<Page["getByRole"]>) => Promise<void>) {
  const picker = page.getByRole("combobox", { name: `Prodotto riga ${line}` });
  await picker.fill(name);
  await page.getByRole("option", { name: `+ Crea «${name}»` }).click();
  const dialog = page.getByRole("dialog", { name: "Nuovo prodotto" });
  await expect(dialog.getByLabel("Nome", { exact: true })).toHaveValue(name);
  await fill(dialog);
  await dialog.getByRole("button", { name: "Salva prodotto" }).click();
  await expect(dialog).toBeHidden();
  await expect(picker).toHaveValue(name);
}

test("scontrino con 3 righe: crea negozio e prodotti, salva, compare nell'elenco con il totale giusto", async ({ page }, testInfo) => {
  const tag = `${run}${testInfo.project.name}`;
  const chain = `E2E Catena ${tag}`;
  await page.goto("/scontrini/nuovo");

  // New store with a new chain, from the store select.
  await page.getByLabel("Negozio", { exact: true }).selectOption({ label: "+ Nuovo negozio…" });
  const storeDialog = page.getByRole("dialog", { name: "Nuovo negozio" });
  const chainSelect = storeDialog.getByLabel("Catena", { exact: true });
  if (await chainSelect.isVisible()) await chainSelect.selectOption({ label: "+ Nuova catena…" });
  await storeDialog.getByLabel("Nome della catena").fill(chain);
  await storeDialog.getByLabel("Punto vendita").fill("Centro");
  await storeDialog.getByRole("button", { name: "Salva negozio" }).click();
  await expect(storeDialog).toBeHidden();
  await expect(page.getByLabel("Negozio", { exact: true })).toHaveValue(/\d+/);

  // Line 1: bananas by weight, with a discount → 1,99 − 0,20 = 1,79 € for 850 g = 2,11 €/kg
  await createProductFromLine(page, 1, `Banane ${tag}`, async (d) => {
    await d.getByLabel("Peso medio a pezzo").fill("120");
  });
  await page.getByLabel("Prezzo riga 1").fill("1,99");
  await page.getByLabel("Pezzi riga 1").fill("6");
  await page.getByLabel("Quantità riga 1").fill("850");
  await page.getByRole("button", { name: "+ sconto" }).click();
  await page.getByLabel("Sconto riga 1").fill("0,20");
  const line1 = page.getByTestId("receipt-line").nth(0);
  await expect(line1).toContainText(euro("1,79"));
  await expect(line1).toContainText(/2,11\s€\/kg/);
  await expect(line1).toContainText(/0,30\s€\/pz/);

  // Line 2: packaged pasta, 2 × 500 g → 1,78 € = 1,78 €/kg
  await page.getByRole("button", { name: "+ Aggiungi prodotto" }).click();
  await createProductFromLine(page, 2, `Spaghetti ${tag}`, async (d) => {
    await d.getByLabel("Confezione").fill("500 g");
  });
  await page.getByLabel("Prezzo riga 2").fill("1,78");
  await page.getByLabel("Pezzi riga 2").fill("2");
  await expect(page.getByTestId("receipt-line").nth(1)).toContainText(/1,78\s€\/kg/);

  // Line 3: milk, by volume
  await page.getByRole("button", { name: "+ Aggiungi prodotto" }).click();
  await createProductFromLine(page, 3, `Latte ${tag}`, async (d) => {
    await d.getByLabel("Come lo compri").selectOption({ label: "a volume (ml)" });
    await d.getByLabel("Confezione").fill("1 l");
  });
  await page.getByLabel("Prezzo riga 3").fill("1,49");

  // 1,79 + 1,78 + 1,49 = 5,06
  await expect(page.getByTestId("receipt-total")).toHaveText(euro("5,06"));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "no horizontal scroll").toBeLessThanOrEqual(0);
  await page.screenshot({ path: testInfo.outputPath("receipt-filled.png"), fullPage: true });
  await page.getByRole("button", { name: "Salva", exact: true }).click();

  await expect(page).toHaveURL(/\/$/);
  const row = page.getByTestId("receipt-row").filter({ hasText: chain });
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId("receipt-row-total")).toHaveText(euro("5,06"));
  await expect(row).toContainText("3 prodotti");

  // Reopen: lines are persisted; then delete (two-step) to leave the DB clean.
  await row.click();
  await expect(page.getByTestId("receipt-line")).toHaveCount(3);
  await expect(page.getByTestId("receipt-total")).toHaveText(euro("5,06"));
  await page.getByRole("button", { name: "Elimina" }).click();
  await page.getByRole("button", { name: "Conferma" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("receipt-row").filter({ hasText: chain })).toHaveCount(0);
});

test("uno scontrino vuoto o con righe incomplete non si salva", async ({ page }) => {
  await page.goto("/scontrini/nuovo");
  await page.getByRole("button", { name: "Salva", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(/negozio|almeno un prodotto/i);
  await expect(page).toHaveURL(/scontrini\/nuovo/);

  // A line with a price but no product is highlighted and blocks the save
  await page.getByLabel("Prezzo riga 1").fill("1,00");
  await page.getByRole("button", { name: "Salva", exact: true }).click();
  await expect(page.getByRole("alert").first()).toContainText(/righe evidenziate|negozio/i);
  await expect(page.getByTestId("receipt-line").first()).toContainText("Scegli il prodotto");
  await expect(page).toHaveURL(/scontrini\/nuovo/);
});
