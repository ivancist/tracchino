import { expect, test, type APIRequestContext } from "@playwright/test";
import { addDays } from "../shared/dates";

const euro = (s: string) => new RegExp(`${s}\\s€`);

/** Two consecutive days of our own in 1902–1934 (other specs: diary 1946–1989, stats 2000–2019). */
function uniqueDays(project: string): [string, string] {
  const offset = (Date.now() % 3000) * 4 + (project === "mobile" ? 2 : 0);
  const d = addDays("1934-12-01", -offset);
  return [d, addDays(d, 1)];
}

/** Receipts created by the current test, deleted afterwards (they would show up in spending stats). */
let receiptIds: number[] = [];
test.beforeEach(() => {
  receiptIds = [];
});
test.afterEach(async ({ request }) => {
  for (const id of receiptIds) await request.delete(`/api/receipts/${id}`);
});

async function seed(request: APIRequestContext, tag: string, [d1, d2]: [string, string]) {
  const post = async (path: string, data: unknown) => {
    const res = await request.post(path, { data });
    expect(res.status(), `${path}: ${await res.text()}`).toBe(201);
    return ((await res.json()) as { id: number }).id;
  };
  const product = (name: string, extra: Record<string, unknown>) => post("/api/products", { name: `${name} ${tag}`, unit: "g", ...extra });
  const pasta = await product("Spaghetti", { packageAmount: 500, kcal100: 359, protein100: 12.5, fat100: 2, carbs100: 71, sugars100: 3.5 });
  const riso = await product("Riso", { packageAmount: 2000, kcal100: 350, protein100: 7, fat100: 0.6, carbs100: 78, sugars100: 0.2 });
  const banana = await product("Banane", { avgPieceAmount: 120, kcal100: 89, protein100: 1.1, fat100: 0.3, carbs100: 22.8 });
  const olio = await post("/api/products", { name: `Olio ${tag}`, unit: "ml", kcal100: 822 });
  const chainId = await post("/api/chains", { name: `E2E Analisi ${tag}` });
  const storeId = await post("/api/stores", { chainId, name: "Sede" });
  receiptIds.push(await post("/api/receipts", { storeId, date: addDays(d1, -11), items: [{ productId: pasta, priceFullCents: 89, pieces: 1 }] }));
  receiptIds.push(await post("/api/receipts", {
    storeId,
    date: addDays(d1, -3),
    items: [
      { productId: pasta, priceFullCents: 198, pieces: 2 },
      { productId: riso, priceFullCents: 449, pieces: 1 },
      { productId: banana, priceFullCents: 179, pieces: 6 },
    ],
  }));
  for (const [date, productId, amount] of [
    [d1, pasta, 80],
    [d1, banana, 120],
    [d2, pasta, 100],
    [d2, olio, 10],
  ] as const) {
    await post("/api/diary", { date, meal: "pranzo", productId, amount });
  }
}

test("analisi della dieta: costo medio, valore dei prodotti, simulazione di una sostituzione", async ({ page, request }, info) => {
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${info.project.name}`;
  const days = uniqueDays(info.project.name);
  await seed(request, tag, days);

  await page.goto("/statistiche?vista=dieta");
  await page.getByRole("button", { name: "Date…" }).click();
  await page.getByLabel("Dal", { exact: true }).fill(days[0]);
  await page.getByLabel("Al", { exact: true }).fill(days[1]);

  // Day 1: 15 + 30 cents; day 2: 19 (oil never bought, excluded) → 32 cents/day, 2.24 €/week
  const tiles = page.getByTestId("diet-tiles");
  await expect(tiles).toContainText(euro("0,32"));
  await expect(tiles).toContainText(euro("2,24"));
  await expect(tiles).toContainText("1 voce senza costo esclusa");
  await expect(page.getByText("2 giorni registrati")).toBeVisible();

  // Pasta: 287 / 1500 g → 5.33 cents (0,053 €) per 100 kcal, 15.3 cents per 10 g protein
  const pastaRow = page.getByTestId("product-value-row").filter({ hasText: `Spaghetti ${tag}` });
  await expect(pastaRow).toContainText(euro("0,053"));
  await expect(pastaRow).toContainText(euro("0,15"));
  await expect(pastaRow).toContainText("mangiato in 2 giorni su 2 (180 g)");
  await expect(page.getByTestId("product-value-row").filter({ hasText: `Olio ${tag}` })).toContainText("n.d. /100 kcal");
  // Cheapest protein first: pasta (0.15 €) before bananas (2.26 €)
  await page.getByRole("button", { name: "€ per 10 g proteine" }).click();
  const names = await page.getByTestId("product-value-row").allTextContents();
  expect(names.findIndex((t) => t.includes(`Spaghetti ${tag}`))).toBeLessThan(names.findIndex((t) => t.includes(`Banane ${tag}`)));

  // What if: rice instead of pasta → +6 cents, −16.2 kcal
  await page.getByLabel("Al posto di").selectOption({ label: `Spaghetti ${tag}` });
  await page.getByLabel("Metti (vuoto = stesso prodotto)").fill(`Riso ${tag}`);
  await page.getByRole("option", { name: `Riso ${tag}` }).click();
  await page.getByRole("button", { name: "Simula" }).click();
  await expect(page.getByTestId("simulation")).toContainText("Su 2 voci in 2 giorni");
  await expect(page.getByTestId("sim-cost")).toContainText(euro("\\+0,06"));
  await expect(page.getByTestId("sim-kcal")).toContainText("-16 kcal");

  // Same pasta, half the grams → −16 cents
  await page.getByRole("button", { name: "Stesso prodotto" }).click();
  await page.getByLabel("Quantità ×").fill("0,5");
  await page.getByRole("button", { name: "Simula" }).click();
  await expect(page.getByTestId("sim-cost")).toContainText(euro("-0,16"));

  // Same pasta, same grams: nothing changes
  await page.getByLabel("Quantità ×").fill("1");
  await page.getByRole("button", { name: "Simula" }).click();
  await expect(page.getByTestId("sim-cost")).toContainText(euro("0,00"));
});

test("statistiche: la vista Spesa resta quella predefinita", async ({ page }) => {
  await page.goto("/statistiche");
  await expect(page.getByRole("tab", { name: "Spesa" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Dieta" }).click();
  await expect(page).toHaveURL(/vista=dieta/);
});
