import { expect, test, type APIRequestContext } from "@playwright/test";
import { addDays } from "../shared/dates";

const euro = (s: string) => new RegExp(`${s}\\s€`);

/**
 * Each run writes on its own day in 1935–1989: never shared between runs/projects, and outside the years other
 * specs use (stats: 2000–2019, analysis: before 1935).
 */
function uniqueDay(project: string, test: 0 | 1): string {
  const offset = (Date.now() % 5000) * 4 + (project === "mobile" ? 1 : 0) + test * 2;
  return addDays("1989-12-01", -offset);
}

/** Receipts created by the current test, deleted afterwards (they would show up in spending stats). */
let receiptIds: number[] = [];
test.beforeEach(() => {
  receiptIds = [];
});
test.afterEach(async ({ request }) => {
  for (const id of receiptIds) await request.delete(`/api/receipts/${id}`);
});

async function seed(request: APIRequestContext, tag: string, day: string) {
  const post = async (path: string, data: unknown) => {
    const res = await request.post(path, { data });
    expect(res.status(), `${path}: ${await res.text()}`).toBe(201);
    return ((await res.json()) as { id: number }).id;
  };
  const pasta = await post("/api/products", {
    name: `Spaghetti ${tag}`,
    unit: "g",
    packageAmount: 500,
    kcal100: 359,
    protein100: 12.5,
    fat100: 2,
    saturatedFat100: 0.4,
    carbs100: 71,
    fiber100: 3,
    salt100: 0.06,
  });
  const banana = await post("/api/products", { name: `Banane ${tag}`, unit: "g", avgPieceAmount: 120, kcal100: 89, protein100: 1.1 });
  const olio = await post("/api/products", { name: `Olio ${tag}`, unit: "ml", kcal100: 822 }); // never bought
  await post(`/api/products/${banana}/portions`, { name: "1 banana", amount: 120 });
  const chainId = await post("/api/chains", { name: `E2E Diario ${tag}` });
  const storeId = await post("/api/stores", { chainId, name: "Sede" });
  receiptIds.push(await post("/api/receipts", {
    storeId,
    date: addDays(day, -5),
    items: [
      { productId: pasta, priceFullCents: 89, pieces: 1 },
      { productId: banana, priceFullCents: 179, pieces: 6 },
    ],
  }));
  return { pasta, banana, olio };
}

test("diario: grammi e porzioni, totali con costo stimato, n.d. per i prodotti mai comprati", async ({ page, request }, info) => {
  const tag = `${Date.now().toString(36)}${info.project.name}`;
  const day = uniqueDay(info.project.name, 0);
  await seed(request, tag, day);

  await page.goto(`/diario?data=${day}`);
  await expect(page.getByTestId("total-kcal")).toContainText("n.d.");
  await expect(page.getByTestId("total-cost")).toContainText("n.d.");

  // Lunch: 80 g of pasta
  await page.getByRole("button", { name: "+ Aggiungi a pranzo" }).click();
  let dialog = page.getByRole("dialog", { name: "Aggiungi a pranzo" });
  await dialog.getByLabel("Alimento").fill(`Spaghetti ${tag}`);
  await dialog.getByRole("option", { name: `Spaghetti ${tag}` }).click();
  await dialog.getByLabel("Peso (g)").fill("80");
  await expect(dialog.getByTestId("entry-preview")).toContainText("287 kcal"); // 359 × 0.8
  await dialog.getByRole("button", { name: "Salva", exact: true }).click();
  await expect(dialog).toBeHidden();
  const lunch = page.getByTestId("meal-pranzo");
  await expect(lunch.getByTestId("diary-entry")).toContainText("80 g");
  await expect(lunch.getByTestId("diary-entry")).toContainText(euro("0,14")); // 80 × 89 / 500 = 14.24 cents

  // Breakfast: 1.5 × "1 banana" (120 g) = 180 g
  await page.getByRole("button", { name: "+ Aggiungi a colazione" }).click();
  dialog = page.getByRole("dialog", { name: "Aggiungi a colazione" });
  await dialog.getByLabel("Alimento").fill(`Banane ${tag}`);
  await dialog.getByRole("option", { name: `Banane ${tag}` }).click();
  await dialog.getByRole("radio", { name: "Porzioni" }).check();
  await dialog.getByLabel("Porzione", { exact: true }).selectOption({ label: "1 banana (120 g)" });
  await dialog.getByLabel("Quante").fill("1,5");
  await expect(dialog.getByTestId("entry-preview")).toContainText("180 g · 160 kcal");
  await dialog.getByRole("button", { name: "Salva", exact: true }).click();
  await expect(dialog).toBeHidden();
  const breakfast = page.getByTestId("meal-colazione").getByTestId("diary-entry");
  await expect(breakfast).toContainText("1,5 × 1 banana (180 g)");
  await expect(breakfast).toContainText(euro("≈ 0,45")); // 180 × 179 / 720 = 44.75, quantity estimated

  // Dinner: oil never bought → cost unknown
  await page.getByRole("button", { name: "+ Aggiungi a cena" }).click();
  dialog = page.getByRole("dialog", { name: "Aggiungi a cena" });
  await dialog.getByLabel("Alimento").fill(`Olio ${tag}`);
  await dialog.getByRole("option", { name: `Olio ${tag}` }).click();
  await dialog.getByLabel("Quantità (ml)").fill("10");
  await dialog.getByRole("button", { name: "Salva", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("meal-cena").getByTestId("diary-entry")).toContainText("costo n.d.");

  // Totals: 287.2 + 160.2 + 82.2 = 529.6 kcal; cost 14 + 45 cents, oil unknown
  await expect(page.getByTestId("total-kcal")).toContainText("530 kcal");
  await expect(page.getByTestId("total-cost")).toContainText(euro("≥ 0,59"));
  await expect(page.getByTestId("total-cost")).toContainText("1 voce senza dato");
  // Protein: 10 + 1.98 = 11.98 g, oil has none
  await expect(page.getByTestId("total-protein")).toContainText("≥ 12 g");
  // Fibre and saturated fat only known for the pasta: 3 × 0.8 = 2.4 g, 0.4 × 0.8 = 0.32 g
  await expect(page.getByTestId("total-fiber")).toContainText("≥ 2,4 g");
  await expect(page.getByTestId("total-fiber")).toContainText("2 voci senza dato");
  await expect(page.getByTestId("total-saturated")).toContainText("≥ 0,3 g");
  await expect(page.getByTestId("total-salt")).toContainText("≥ 0,05 g"); // 0.06 × 0.8 = 0.048

  // Edit lunch to 100 g, then delete it
  await lunch.getByTestId("diary-entry").click();
  dialog = page.getByRole("dialog", { name: "Modifica voce" });
  await expect(dialog.getByLabel("Peso (g)")).toHaveValue("80");
  await dialog.getByLabel("Peso (g)").fill("100");
  await dialog.getByRole("button", { name: "Salva", exact: true }).click();
  await expect(lunch.getByTestId("diary-entry")).toContainText("100 g");
  await lunch.getByTestId("diary-entry").click();
  await dialog.getByRole("button", { name: "Elimina" }).click();
  await dialog.getByRole("button", { name: "Conferma eliminazione" }).click();
  await expect(lunch.getByTestId("diary-entry")).toHaveCount(0);
  await expect(page.getByTestId("total-kcal")).toContainText("242 kcal"); // 160.2 + 82.2

  // Cost preferences (window, mode) are remembered on reload; the window only applies to the average.
  await page.getByText("Come è calcolato il costo").click();
  await page.getByLabel("Acquisti degli ultimi").selectOption("30");
  await page.getByLabel("Calcola il costo con").selectOption("last");
  await expect(page.getByLabel("Acquisti degli ultimi")).toBeHidden();
  await page.reload();
  await page.getByText("Come è calcolato il costo").click();
  await expect(page.getByLabel("Calcola il costo con")).toHaveValue("last");
  await page.getByLabel("Calcola il costo con").selectOption("average");
  await expect(page.getByLabel("Acquisti degli ultimi")).toHaveValue("30");
});

test("diario: nuova porzione creata al volo, navigazione tra i giorni", async ({ page, request }, info) => {
  const tag = `${Date.now().toString(36)}${info.project.name}p`;
  const day = uniqueDay(info.project.name, 1);
  const { pasta } = await seed(request, tag, day);

  await page.goto(`/diario?data=${day}`);
  await page.getByRole("button", { name: "+ Aggiungi a spuntini" }).click();
  const dialog = page.getByRole("dialog", { name: "Aggiungi a spuntini" });
  await dialog.getByLabel("Alimento").fill(`Spaghetti ${tag}`);
  await dialog.getByRole("option", { name: `Spaghetti ${tag}` }).click();
  await dialog.getByRole("radio", { name: "Porzioni" }).check();
  await dialog.getByLabel("Porzione", { exact: true }).selectOption({ label: "+ Nuova porzione…" });
  await dialog.getByLabel("Nome porzione").fill("1 piatto");
  await dialog.getByLabel("Grammi della porzione").fill("90");
  await dialog.getByRole("button", { name: "Salva porzione" }).click();
  await expect(dialog.getByLabel("Porzione", { exact: true })).toHaveValue(/\d+/);
  await dialog.getByRole("button", { name: "Salva", exact: true }).click();
  await expect(page.getByTestId("meal-snack").getByTestId("diary-entry")).toContainText("1 × 1 piatto (90 g)");

  // The portion is now on the product page too
  const portions = (await (await request.get(`/api/products/${pasta}/portions`)).json()) as { name: string; amount: number }[];
  expect(portions).toEqual([expect.objectContaining({ name: "1 piatto", amount: 90 })]);

  // Day navigation
  await page.getByRole("button", { name: "Giorno successivo" }).click();
  await expect(page).toHaveURL(new RegExp(`data=${addDays(day, 1)}`));
  await expect(page.getByTestId("diary-entry")).toHaveCount(0);
  await page.getByRole("button", { name: "Giorno precedente" }).click();
  await expect(page.getByTestId("diary-entry")).toHaveCount(1);
  await page.getByRole("button", { name: "torna a oggi" }).click();
  await expect(page).toHaveURL(/\/diario$/);
  await expect(page.getByRole("button", { name: "Giorno successivo" })).toBeDisabled();
});

test("navigazione: Diario nella barra, Negozi sotto Altro", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Sezioni" });
  await nav.getByRole("link", { name: "Diario" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Diario");
  await nav.getByRole("link", { name: "Altro" }).click();
  await page.getByRole("link", { name: /Negozi e catene/ }).click();
  await expect(page).toHaveURL(/\/negozi$/);
  await expect(nav.getByRole("link", { name: "Altro" })).toHaveClass(/active/);
});
