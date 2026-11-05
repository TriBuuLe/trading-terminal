import { expect, test } from "@playwright/test";

test("demo: app loads, watchlist renders, a demo order updates positions", async ({ page }) => {
  await page.goto("/");

  // Visible DEMO banner: mock data is never shown without it.
  await expect(page.getByText(/Demo data: prices and fills are simulated/i)).toBeVisible();

  // The planner is the home screen (first run shows the setup wizard); switch to the terminal.
  await expect(page.getByText("Set up your plan")).toBeVisible();
  await page.getByRole("tab", { name: "Terminal" }).click();

  // Watchlist renders with live (simulated) prices.
  const watchlist = page.locator("section", { hasText: "Watchlist · Main" });
  await expect(watchlist.getByText("AAPL", { exact: true })).toBeVisible();
  await expect(watchlist.locator("tbody tr")).toHaveCount(8);

  // Pick AAPL and place a market buy for 2 shares through the ticket.
  await watchlist.getByText("AAPL", { exact: true }).click();
  const ticket = page.locator("section", { hasText: "Order ticket" });
  await expect(ticket.getByText("AAPL", { exact: true }).first()).toBeVisible();
  await ticket.getByLabel("Shares").fill("2");
  await ticket.getByLabel("Why").fill("e2e smoke test");
  await ticket.getByRole("button", { name: /Review buy order/i }).click();
  await page.getByRole("button", { name: /Submit buy order/i }).click();
  await expect(page.getByText(/Paper order sent: buy 2 AAPL \(filled\)/i)).toBeVisible();

  // Positions now show 2 AAPL.
  await page.getByRole("button", { name: "Dashboard" }).click();
  const positions = page.locator("table", { has: page.getByRole("columnheader", { name: "Avg entry" }) });
  const row = positions.locator("tbody tr", { hasText: "AAPL" });
  await expect(row).toBeVisible();
  await expect(row.locator("td").nth(1)).toHaveText("2");

  // And the journal recorded the why.
  await page.getByRole("button", { name: "Journal" }).click();
  await expect(page.getByText("e2e smoke test")).toBeVisible();
});
