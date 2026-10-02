import { expect, test } from "@playwright/test";
import { addDays, weekStart } from "../shared/dates";

const euro = (s: string) => new RegExp(`${s}\\s€`);

test("statistiche e confronto prezzi tra negozi (dati calcolati a mano)", async ({ page, request }, info) => {
  // A random past year keeps this run's week free of other data; everything is deleted at the end.
  const year = 2000 + Math.floor(Math.random() * 20);
  const monday = weekStart(`${year}-03-10`);
  const sunday = addDays(monday, 6);
  const tag = `${Date.now().toString(36)}${info.project.name}`;

  const post = async (path: string, data: unknown) => {
    const res = await request.post(path, { data });
    expect(res.status(), await res.text()).toBe(201);
    return ((await res.json()) as { id: number }).id;
  };
  const esselunga = await post("/api/stores", { chainId: await post("/api/chains", { name: `E2E Ess ${tag}` }), name: "Centro" });
  const lidl = await post("/api/stores", { chainId: await post("/api/chains", { name: `E2E Lidl ${tag}` }), name: "Viale" });
  const groupId = await post("/api/groups", { name: `E2E Banane ${tag}` });
  const chiquita = await post("/api/products", { name: `Banane Chiquita ${tag}`, unit: "g", groupId });
  const sfuse = await post("/api/products", { name: `Banane sfuse ${tag}`, unit: "g", groupId });
  const receipts = [
    // 2,00 € for 1 kg → 2,00 €/kg
    await post("/api/receipts", { storeId: esselunga, date: monday, items: [{ productId: chiquita, priceFullCents: 200, amount: 1000 }] }),
    // 1,20 € for 800 g → 1,50 €/kg
    await post("/api/receipts", { storeId: lidl, date: addDays(monday, 2), items: [{ productId: sfuse, priceFullCents: 120, amount: 800 }] }),
  ];

  try {
    // --- Spending stats over exactly that ISO week ---
    await page.goto("/statistiche");
    await page.getByRole("button", { name: "Date…" }).click();
    await page.getByLabel("Dal", { exact: true }).fill(monday);
    await page.getByLabel("Al", { exact: true }).fill(sunday);
    const tiles = page.getByTestId("stats-tiles");
    // total 3,20 €; daily mean 320 / 7 = 45.7 → 0,46 €; median 0 (5 of 7 days without purchases); 1 complete week
    await expect(tiles).toContainText(euro("3,20"));
    await expect(tiles.locator(".tile", { hasText: "Media al giorno" })).toContainText(euro("0,46"));
    await expect(tiles.locator(".tile", { hasText: "Mediana al giorno" })).toContainText(euro("0,00"));
    await expect(tiles.locator(".tile", { hasText: "Media a settimana" })).toContainText(euro("3,20"));
    await expect(tiles.locator(".tile", { hasText: "Media a settimana" })).toContainText("1 settimana");
    await expect(page.getByTestId("top-products")).toContainText(`Banane Chiquita ${tag}`);

    // Chart offers a table view with the same numbers
    const dayChart = page.locator("figure", { hasText: "Spesa per giorno" });
    await dayChart.getByRole("button", { name: "Tabella" }).click();
    await expect(dayChart.locator("table tr")).toHaveCount(7);
    await expect(dayChart.locator("table tr").first()).toContainText(euro("2,00")); // exact, not the rounded axis "2 €"

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "no horizontal scroll").toBeLessThanOrEqual(0);
    await page.screenshot({ path: info.outputPath("stats.png"), fullPage: true });

    // --- Store comparison for the group: Lidl cheaper per kg ---
    await page.goto(`/prodotti/${chiquita}`);
    const section = page.getByTestId("price-section");
    await expect(section.getByTestId("store-comparison").locator("li")).toHaveCount(1);
    await section.getByRole("button", { name: /Tutto il gruppo/ }).click();
    const rows = section.getByTestId("store-comparison").locator("li");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText(`E2E Lidl ${tag}`);
    await expect(rows.nth(0)).toContainText(/1,50\s€\/kg/);
    await expect(rows.nth(0)).toContainText("più conveniente");
    await expect(rows.nth(1)).toContainText(/2,00\s€\/kg/);
    await page.screenshot({ path: info.outputPath("prices.png"), fullPage: true });
  } finally {
    for (const id of receipts) await request.delete(`/api/receipts/${id}`);
  }
});
