import { expect, test } from "@playwright/test";
import { addDays, todayRome } from "../shared/dates";

// The pantry forecast is relative to today, so this spec writes diary entries in the last days (other specs use old
// years). Everything it creates carries a unique tag and is deleted afterwards.
const uniqueTag = (project: string) => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${project}`;

test("spesa: suggerito → aggiunto → scontrino → esce; consumi in statistiche; scorta nel prodotto", async ({ page, request }, info) => {
  const tag = uniqueTag(info.project.name);
  const today = todayRome();
  const created = { receipts: [] as number[], diary: [] as number[], products: [] as number[] };
  const post = async (path: string, data: unknown) => {
    const res = await request.post(path, { data });
    expect(res.ok(), `${path}: ${await res.text()}`).toBe(true);
    return ((await res.json()) as { id: number }).id;
  };

  try {
    const chainId = await post("/api/chains", { name: `E2E Lista ${tag}` });
    const storeId = await post("/api/stores", { chainId, name: "Centro" });
    const yogurt = await post("/api/products", { name: `Yogurt ${tag}`, unit: "g", packageAmount: 1000 });
    const tuna = await post("/api/products", { name: `Tonno ${tag}`, unit: "g", packageAmount: 112 });
    created.products.push(yogurt, tuna);
    // 1 kg of yogurt bought 4 days ago, 200 g a day since → 200 g left, runs out tomorrow
    created.receipts.push(await post("/api/receipts", { storeId, date: addDays(today, -4), items: [{ productId: yogurt, priceFullCents: 440, packages: 1 }] }));
    for (const d of [-3, -2, -1, 0]) created.diary.push(await post("/api/diary", { date: addDays(today, d), meal: "colazione", productId: yogurt, amount: 200 }));
    // Tuna eaten but never bought in the app: no forecast, so never suggested
    created.diary.push(await post("/api/diary", { date: today, meal: "pranzo", productId: tuna, amount: 224 }));

    await page.goto("/spesa");
    const nav = page.getByRole("navigation", { name: "Sezioni" });
    await expect(nav.getByRole("link", { name: "Spesa" })).toHaveClass(/active/);
    await expect(page.getByRole("navigation", { name: "Spesa" }).getByRole("link", { name: "Lista" })).toHaveAttribute("aria-current", "page");
    const suggestion = page.getByTestId("urgency-soon").getByTestId("suggestion").filter({ hasText: `Yogurt ${tag}` });
    await expect(suggestion).toContainText(/Restano 200 g · finisce domani/);
    await expect(page.getByTestId("suggestion").filter({ hasText: `Tonno ${tag}` })).toHaveCount(0);

    // Accept it with 2 packages instead of the suggested 1
    const qty = suggestion.getByLabel(`Confezioni di Yogurt ${tag}`);
    await expect(qty).toHaveValue("1");
    await qty.fill("2");
    await qty.blur();
    await suggestion.getByRole("button", { name: "+ Aggiungi" }).click();
    const listed = page.getByTestId("shopping-item").filter({ hasText: `Yogurt ${tag}` });
    await expect(listed.getByLabel(`Confezioni di Yogurt ${tag}`)).toHaveValue("2");
    await expect(suggestion).toHaveCount(0); // already on the list

    // A free-text item
    await page.getByLabel("Altro da comprare").fill(`Candele ${tag}`);
    await page.getByRole("button", { name: "Aggiungi", exact: true }).click();
    await expect(page.getByTestId("shopping-item").filter({ hasText: `Candele ${tag}` })).toHaveCount(1);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "no horizontal scroll").toBeLessThanOrEqual(0);
    if (info.project.name === "mobile") {
      // The narrowest supported width: no tab label is cut off
      await page.setViewportSize({ width: 360, height: 780 });
      const clipped = await page.locator(".tab").evaluateAll((tabs) => tabs.filter((t) => t.scrollWidth > t.clientWidth).map((t) => t.textContent));
      expect(clipped).toEqual([]);
    }
    await page.screenshot({ path: info.outputPath("shopping-list.png"), fullPage: true });

    // Consumption, with frequency: in Statistiche → Spesa, "Dove vanno i soldi"; monthly cost among the tiles
    await page.goto("/statistiche");
    await expect(page.getByRole("tab")).toHaveText(["Spesa", "Dieta"]);
    // Other specs write receipts in 1902–2019: "Tutto" would be too long a period while they run
    await page.getByRole("button", { name: "30 giorni" }).click();
    await expect(page.getByTestId("stats-tiles")).toContainText("Al mese, ai consumi attuali");
    const top = page.getByTestId("top-products").getByRole("link").filter({ hasText: `Yogurt ${tag}` });
    await expect(top.getByTestId("top-consumption")).toHaveText(/^200 g a pasto · 1 confezione ogni 5 giorni · 6 al mese · 26,40\s€ al mese$/);
    await page.screenshot({ path: info.outputPath("stats.png"), fullPage: true });

    // Product page: package and its price first, then stock and consumption
    await top.click();
    await expect(page.getByTestId("package-summary")).toContainText("Confezione da 1 kg");
    await expect(page.getByTestId("package-price")).toHaveText(/^4,40\s€ a confezione$/);
    await expect(page.getByTestId("package-summary")).toContainText(/4,40\s€\/kg/);
    const stock = page.getByTestId("stock-section");
    await expect(stock.getByTestId("stock-text")).toHaveText(/Restano 200 g · finisce domani/);
    // Shared yogurt: only 100 g left. Then it's finished.
    await stock.getByRole("button", { name: "Correggi la scorta" }).click();
    await stock.getByLabel("Quanto ne hai ancora").fill("100 g");
    await stock.getByRole("button", { name: "Salva" }).click();
    await expect(stock.getByTestId("stock-text")).toHaveText(/Restano 100 g · finisce oggi.*corretta da te/);
    await stock.getByRole("button", { name: "Correggi la scorta" }).click();
    await stock.getByRole("button", { name: "È finito" }).click();
    await expect(stock.getByTestId("stock-text")).toContainText("Finito");
    await page.screenshot({ path: info.outputPath("product.png"), fullPage: true });

    // Products list: price per package instead of kcal, stock left instead of purchases; finished is flagged
    await page.goto("/prodotti");
    const row = page.getByTestId("product-row").filter({ hasText: `Yogurt ${tag}` });
    await expect(row).toContainText(/confezione da 1 kg · 4,40\s€ a conf\./);
    await expect(row.getByTestId("product-stock").locator(".badge.finished")).toHaveText("Finito");
    await expect(row).not.toContainText("1×");
    await page.screenshot({ path: info.outputPath("products.png") }); // not full page: the local catalog holds every e2e run's products

    // Receipts: floating buttons, scan above new
    await page.goto("/spesa/scontrini");
    const fabs = page.locator(".fab-stack .fab");
    await expect(fabs).toHaveCount(2);
    const [scanBox, newBox] = [await fabs.nth(0).boundingBox(), await fabs.nth(1).boundingBox()];
    expect(scanBox!.y).toBeLessThan(newBox!.y);
    expect(Math.round(newBox!.width)).toBe(Math.round(newBox!.height)); // 1:1
    await page.screenshot({ path: info.outputPath("receipts.png") });
    await page.getByRole("link", { name: "Nuovo scontrino" }).click();
    await expect(page).toHaveURL(/\/scontrini\/nuovo$/);

    // Next receipt: 1 package bought → 1 left on the list; another one → gone. Free text stays.
    created.receipts.push(await post("/api/receipts", { storeId, date: today, items: [{ productId: yogurt, priceFullCents: 440, packages: 1 }] }));
    await page.goto("/spesa");
    await expect(listed.getByLabel(`Confezioni di Yogurt ${tag}`)).toHaveValue("1");
    created.receipts.push(await post("/api/receipts", { storeId, date: today, items: [{ productId: yogurt, priceFullCents: 440 }] }));
    await page.reload();
    await expect(listed).toHaveCount(0);

    // Ticking an item removes it
    await page.getByRole("button", { name: `Preso: Candele ${tag}` }).click();
    await expect(page.getByTestId("shopping-item").filter({ hasText: `Candele ${tag}` })).toHaveCount(0);
  } finally {
    const leftovers = (await (await request.get("/api/shopping-list")).json()) as { id: number; name: string }[];
    for (const item of leftovers.filter((i) => i.name.endsWith(tag))) await request.delete(`/api/shopping-list/${item.id}`);
    for (const id of created.receipts) await request.delete(`/api/receipts/${id}`);
    for (const id of created.diary) await request.delete(`/api/diary/${id}`);
    for (const id of created.products) await request.delete(`/api/products/${id}`); // cascades to list items
  }
});
