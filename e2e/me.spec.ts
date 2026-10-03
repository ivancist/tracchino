import { expect, test } from "@playwright/test";

test("l'icona dell'account, solo in Altro, mostra l'account e il database connesso", async ({ page }) => {
  await page.goto("/diario");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Diario");
  await expect(page.getByRole("button", { name: "Account" })).toHaveCount(0);

  await page.goto("/altro");
  await page.getByRole("button", { name: "Account" }).click();
  const dialog = page.getByRole("dialog", { name: "Account" });
  // Dev bypass identifies as ALLOWED_EMAIL from .dev.vars (not committed): check the shape only
  await expect(dialog.getByTestId("me-email")).toHaveText(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
  await expect(dialog.getByTestId("me-db")).toHaveText("Connesso");
  await dialog.getByRole("button", { name: "Chiudi" }).click();
  await expect(dialog).toBeHidden();
});

test("il layout non scorre orizzontalmente", async ({ page }) => {
  await page.goto("/altro");
  await expect(page.getByRole("link", { name: /Prodotti/ })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
