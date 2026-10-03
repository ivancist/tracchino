import { expect, test } from "@playwright/test";

test("la pagina 'Chi sono' mostra l'account e il database connesso", async ({ page }) => {
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Chi sono" })).toBeVisible();
  // Dev bypass identifies as ALLOWED_EMAIL from .dev.vars (not committed): check the shape only
  await expect(page.getByTestId("me-email")).toHaveText(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
  await expect(page.getByTestId("me-db")).toHaveText("Connesso");
});

test("il layout non scorre orizzontalmente", async ({ page }) => {
  await page.goto("/account");
  await expect(page.getByTestId("me-email")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
