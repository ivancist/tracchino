import { expect, test } from "@playwright/test";
import { addDays, todayRome } from "../shared/dates";

// The pantry forecast is relative to today, so this spec writes diary entries in the last days (other specs use old
// years). Everything it creates carries a unique tag and is deleted afterwards.
const uniqueTag = (project: string) => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${project}`;

test("lista della spesa: suggerito → aggiunto → scontrino → esce dalla lista", async ({ page, request }, info) => {
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

    await page.goto("/lista");
    await expect(page.getByRole("link", { name: "Lista" })).toHaveClass(/active/);
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
      // Six tabs at the narrowest supported width: no label is cut off
      await page.setViewportSize({ width: 360, height: 780 });
      const clipped = await page.locator(".tab").evaluateAll((tabs) => tabs.filter((t) => t.scrollWidth > t.clientWidth).map((t) => t.textContent));
      expect(clipped).toEqual([]);
      await page.screenshot({ path: info.outputPath("tabs-360.png") });
    }
    await page.screenshot({ path: info.outputPath("shopping-list.png"), fullPage: true });

    // Pantry and monthly use
    await page.getByRole("tab", { name: "Scorte e consumi" }).click();
    const pantryYogurt = page.getByTestId("pantry-item").filter({ hasText: `Yogurt ${tag}` });
    await expect(pantryYogurt).toContainText("200 g al giorno · 1 confezione ogni 5 giorni · 6 al mese");
    await expect(pantryYogurt).toContainText(/26,40\s€ al mese/);
    const pantryTuna = page.getByTestId("pantry-item").filter({ hasText: `Tonno ${tag}` });
    await expect(pantryTuna).toContainText("Scorta sconosciuta");
    await expect(pantryTuna).toContainText("Diario di 1 giorno da quando l'hai mangiato"); // one meal: no monthly projection
    await page.screenshot({ path: info.outputPath("pantry.png"), fullPage: true });

    // Next receipt: 1 package bought → 1 left on the list; another one → gone. Free text stays.
    created.receipts.push(await post("/api/receipts", { storeId, date: today, items: [{ productId: yogurt, priceFullCents: 440, packages: 1 }] }));
    await page.getByRole("tab", { name: "Lista" }).click();
    await page.reload();
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
