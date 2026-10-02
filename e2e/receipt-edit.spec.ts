import { expect, test, type APIRequestContext } from "@playwright/test";
import { todayRome } from "../shared/dates";

const euro = (s: string) => new RegExp(`${s}\\s€`);

/** Seeds data through the API (local dev bypass), with names unique per run. */
async function seed(request: APIRequestContext, tag: string) {
  const post = async (path: string, data: unknown) => {
    const res = await request.post(path, { data });
    expect(res.status(), `${path}: ${await res.text()}`).toBe(201);
    return ((await res.json()) as { id: number }).id;
  };
  const chainId = await post("/api/chains", { name: `E2E Edit ${tag}` });
  const storeId = await post("/api/stores", { chainId, name: "Sede" });
  const milk = await post("/api/products", { name: `Latte ${tag}`, unit: "ml", packageAmount: 1000 });
  const bread = await post("/api/products", { name: `Pane ${tag}`, unit: "g" });
  const receiptId = await post("/api/receipts", {
    storeId,
    date: todayRome(),
    items: [
      { productId: milk, priceFullCents: 149 },
      { productId: bread, priceFullCents: 250, amount: 500 },
    ],
  });
  return { chainId, storeId, milk, bread, receiptId, chain: `E2E Edit ${tag}` };
}

test("modifica di uno scontrino: cambia prezzo, rimuove una riga, ignora una riga vuota", async ({ page, request }, info) => {
  const tag = `${Date.now().toString(36)}${info.project.name}`;
  const { receiptId, chain } = await seed(request, tag);

  await page.goto(`/scontrini/${receiptId}`);
  await expect(page.getByTestId("receipt-line")).toHaveCount(2);
  await expect(page.getByTestId("receipt-total")).toHaveText(euro("3,99"));
  // "ultima volta" must not show this very receipt's own price
  await expect(page.getByTestId("receipt-line").first()).not.toContainText("ultima volta");

  await page.getByLabel("Prezzo riga 1").fill("1,59");
  await page.getByRole("button", { name: "Rimuovi riga 2" }).click();
  await page.getByRole("button", { name: "+ Aggiungi prodotto" }).click(); // left blank on purpose
  await expect(page.getByTestId("receipt-total")).toHaveText(euro("1,59"));
  await page.getByRole("button", { name: "Salva", exact: true }).click();

  await expect(page).toHaveURL(/\/$/);
  const row = page.getByTestId("receipt-row").filter({ hasText: chain });
  await expect(row.getByTestId("receipt-row-total")).toHaveText(euro("1,59"));
  await expect(row).toContainText("1 prodotto");
});

test("nuovo scontrino: il prezzo si precompila con l'ultimo pagato in quel negozio", async ({ page, request }, info) => {
  const tag = `${Date.now().toString(36)}p${info.project.name}`;
  const { storeId } = await seed(request, tag);

  await page.goto("/scontrini/nuovo");
  await page.getByLabel("Negozio", { exact: true }).selectOption(String(storeId));
  await page.getByRole("combobox", { name: "Prodotto riga 1" }).fill(`Latte ${tag}`);
  await page.getByRole("option", { name: `Latte ${tag}` }).click();
  await expect(page.getByLabel("Prezzo riga 1")).toHaveValue("1,49");
  await expect(page.getByTestId("receipt-line").first()).toContainText("ultima volta");

  // An incomplete line is flagged and left out of the total
  await page.getByRole("button", { name: "+ Aggiungi prodotto" }).click();
  await page.getByLabel("Prezzo riga 2").fill("2,00");
  await expect(page.getByTestId("receipt-total")).toHaveText(euro("1,49"));
  await expect(page.getByTestId("receipt-total-warning")).toHaveText("1 riga incompleta esclusa");
});

test("sessione Access scaduta: mostra l'avviso invece di 'Failed to fetch'", async ({ page }) => {
  // What Cloudflare Access does when the session expires: redirect API calls to its login page.
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 302, headers: { Location: "https://team.cloudflareaccess.com/cdn-cgi/access/login" } }),
  );
  await page.goto("/account");
  await expect(page.getByRole("alert").filter({ hasText: "Sessione scaduta" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Accedi di nuovo" })).toBeVisible();
});

test("unione di prodotti con unità diverse: bloccata", async ({ page, request }, info) => {
  const tag = `${Date.now().toString(36)}m${info.project.name}`;
  const { milk } = await seed(request, tag);
  await page.goto(`/prodotti/${milk}`);
  await page.getByRole("combobox", { name: "Unisci a" }).fill(`Pane ${tag}`);
  await page.getByRole("option", { name: `Pane ${tag}` }).click();
  await expect(page.getByText("Unità diverse")).toBeVisible();
  await expect(page.getByRole("button", { name: /Unisci a/ })).toBeDisabled();
  // No "+ Crea" in the merge picker
  await page.getByRole("combobox", { name: "Unisci a" }).fill("inesistente xyz");
  await expect(page.getByRole("option", { name: /Crea/ })).toHaveCount(0);
});
