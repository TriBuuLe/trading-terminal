import { expect, test } from "@playwright/test";

/** Planner Analysis tab: year totals, month chart, where the money went, from a profile + imported transactions. */
test("analysis: take-home for the year, spending by category, needs attention", async ({ page, request }) => {
  const y = new Date().getFullYear();
  const profile = {
    country: "US", region: "NC", age: 21, crossBorder: false,
    incomes: [
      { id: "a", name: "Summer job", amount: 3000, frequency: "monthly", kind: "salary", startMonth: `${y}-01`, endMonth: `${y}-04` },
      { id: "b", name: "Co-op", amount: 5300, frequency: "monthly", kind: "coop", startMonth: `${y}-09`, endMonth: `${y}-12` },
    ],
    expenses: [
      { id: "r1", category: "Rent", monthly: 900, kind: "need", startMonth: `${y}-01`, endMonth: `${y}-04` },
      { id: "r2", category: "Rent", monthly: 1200, kind: "need", startMonth: `${y}-05`, endMonth: null },
      { id: "d", category: "Dining out", monthly: 150, kind: "want" },
      { id: "f", category: "Fun", monthly: 40, kind: "want" }, // an old free-text name
    ],
    debts: [], accounts: [], goals: [],
    risk: { horizonYears: 10, drawdownReaction: 3, incomeStability: 2, experience: 1 },
    sandboxPct: 10, highInterestAprPct: 8,
  };
  try {
    expect((await request.put("/api/finances/profile", { data: profile })).ok()).toBe(true);
    const rows = [
      { date: `${y}-09-05`, description: "TAQUERIA", amount: -40, category: "Dining out" },
      { date: `${y}-09-12`, description: "ACME DES:PAYROLL", amount: 2650, category: "Income" },
      { date: `${y}-10-12`, description: "ACME DES:PAYROLL", amount: 2650, category: "Income" },
      { date: `${y}-09-20`, description: "SUSHI", amount: -260, category: "Dining out" },
      { date: `${y}-10-04`, description: "MR. TIRE", amount: -607.34, category: "Transportation" },
      { date: `${y}-10-12`, description: "NIKE", amount: -91.38, category: "Shopping" },
      { date: `${y}-10-20`, description: "AIR CANADA 0142", amount: -420, category: "Transportation" }, // saved before Travel existed
    ];
    expect((await request.post("/api/finances/transactions", { data: { rows } })).ok()).toBe(true);

    await page.goto("/");
    await page.getByRole("button", { name: "Analysis", exact: true }).click();
    // Money in comes from transactions (2 × 2,650), compared with the income lines for those months (2 × 5,300).
    await expect(page.getByText(`Money in, ${y}`)).toBeVisible();
    await expect(page.getByText("$5,300").first()).toBeVisible();
    await expect(page.getByText(/of it paychecks\. Your income lines expected \$10,600/)).toBeVisible();
    await expect(page.getByText("Where the money came from")).toBeVisible();
    await expect(page.getByText(/Transportation: \$1,027 this year .*no budget line/)).toBeVisible(); // 607.34 + 420 (Air Canada, not yet re-sorted)
    // Each category is its own row; clicking shows its biggest purchases.
    await page.getByRole("cell", { name: "Dining out", exact: true }).click();
    await expect(page.getByText(/Biggest: SUSHI/)).toBeVisible();
    await page.screenshot({ path: "test-results/analysis.png", fullPage: true });
    // Transactions is storage/import only now.
    await page.getByRole("button", { name: "Transactions", exact: true }).click();
    await expect(page.getByText("Import a bank or credit-card CSV")).toBeVisible();
    await expect(page.getByText("Spending vs budget")).toHaveCount(0);

    // Re-check categories: the old Air Canada row moves to Travel after confirming.
    await page.getByRole("button", { name: "Re-check", exact: true }).click();
    await expect(page.getByText("AIR CANADA 0142")).toBeVisible();
    await page.getByRole("button", { name: "Apply 1" }).click();
    await expect(page.getByText(/Updated 1 transaction/)).toBeVisible();
    await page.getByRole("button", { name: "Analysis", exact: true }).click();
    await expect(page.getByText(/Travel: \$420 this year .*no budget line/)).toBeVisible();
    await expect(page.getByText(/Transportation: \$607 this year .*no budget line/)).toBeVisible();

    // My finances: budget categories are a dropdown from the shared list; an old name offers its standard one.
    await page.getByRole("button", { name: "My finances", exact: true }).click();
    await expect(page.getByRole("button", { name: "use Entertainment?" })).toBeVisible();
    await page.getByRole("button", { name: "use Entertainment?" }).click();
    await expect(page.getByRole("button", { name: "use Entertainment?" })).toHaveCount(0);
    await page.getByText("Monthly spending").first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/finances.png" });
  } finally {
    await request.delete("/api/finances/export");
  }
});
