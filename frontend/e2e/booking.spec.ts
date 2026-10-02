import { test, expect } from "@playwright/test";
test("customer reserves seats, confirms sandbox payment, views QR and cancels", async ({
  page,
}) => {
  const password = process.env.E2E_DEMO_PASSWORD;
  if (!password)
    throw new Error(
      "Set E2E_DEMO_PASSWORD to the running demo DEMO_PASSWORD. Use disposable sandbox data.",
    );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Sign in", exact: false })
    .first()
    .click();
  await page
    .getByLabel("Email", { exact: true })
    .fill("customer@seatflow.example");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await expect(page.getByText("Imran Demo", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pick seats" }).first().click();
  await page
    .getByRole("button", { name: /Seat .* AVAILABLE/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Reserve seats" }).click();
  await page
    .getByRole("button", { name: "Simulate successful payment" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your ticket is ready" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copy ticket token" }),
  ).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Cancel booking", exact: true })
    .click();
  await expect(page.getByText("CANCELLED", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
});
