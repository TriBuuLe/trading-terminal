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
      { date: `${y}-09-11`, description: "FID BKG SVC LLC DES:MONEYLINE", amount: -500, category: "Transfers" },
      { date: `${y}-10-07`, description: "FID BKG SVC LLC DES:MONEYLINE", amount: 120, category: "Transfers" },
    ];
    expect((await request.post("/api/finances/transactions", { data: { rows } })).ok()).toBe(true);
    // Uploading the same statement again saves nothing; an overlapping one saves only the new rows.
    expect(await (await request.post("/api/finances/transactions", { data: { rows } })).json()).toMatchObject({ saved: 0, duplicates: rows.length });
    const overlap = [rows[0]!, { date: `${y}-10-21`, description: "PRESTO FARE", amount: -8.12, category: "Transportation" }, { date: `${y}-10-21`, description: "PRESTO FARE", amount: -8.12, category: "Transportation" }];
    expect(await (await request.post("/api/finances/transactions", { data: { rows: overlap } })).json()).toMatchObject({ saved: 2, duplicates: 1 }); // two real same-day fares both kept
    expect(await (await request.post("/api/finances/transactions", { data: { rows: overlap } })).json()).toMatchObject({ saved: 0, duplicates: 3 });

    await page.goto("/");
    await page.getByRole("button", { name: "Analysis", exact: true }).click();
    // Money in comes from transactions (2 × 2,650), compared with the income lines for those months (2 × 5,300).
    await expect(page.getByText(`Money in, ${y}`)).toBeVisible();
    await expect(page.getByText("$5,300").first()).toBeVisible();
    await expect(page.getByText(/of it paychecks\. Your income lines expected \$10,600/)).toBeVisible();
    await expect(page.getByText("Where the money came from")).toBeVisible();
    // Investments: 500 sent − 120 back = 380 invested, not spending.
    await expect(page.getByText("Investments & what you have")).toBeVisible();
    await expect(page.getByText("$380.00").first()).toBeVisible();
    await expect(page.getByText(/Transportation: \$1,044 this year .*no budget line/)).toBeVisible(); // 607.34 + 420 (Air Canada, not yet re-sorted) + 2 × 8.12
    // Where the money went: one line per category with its total; clicking shows merchants and transactions.
    await expect(page.getByText(/Where your \$[\d,]+ went/)).toBeVisible();
    const dining = page.getByRole("button", { name: /Dining out\s*\$300\.00/ });
    await dining.click();
    await expect(page.getByText("By merchant")).toBeVisible();
    await expect(page.getByRole("cell", { name: "Sushi", exact: true })).toBeVisible();
    await page.screenshot({ path: "test-results/analysis.png", fullPage: true });
    // Assistant tab: without a Gemini key (demo/e2e) it says why it's unavailable instead of failing.
    await page.getByRole("button", { name: "Assistant", exact: true }).click();
    await expect(page.getByText("Assistant unavailable")).toBeVisible();
    await expect(page.getByText(/GEMINI_API_KEY isn't set/)).toBeVisible();
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
    await expect(page.getByText(/Transportation: \$624 this year .*no budget line/)).toBeVisible();

    // My finances: budget categories are a dropdown from the shared list; an old name offers its standard one.
    await page.getByRole("button", { name: "My finances", exact: true }).click();
    // Income from your transactions: the ACME paychecks (Sep 12, Oct 12) propose replacing the overlapping "Co-op" line.
    // Each income line is one row; the ACME deposits match the "Co-op" line and can be applied to it.
    await page.getByRole("button", { name: "use deposits" }).click();
    await expect(page.getByRole("button", { name: "use deposits" })).toHaveCount(0);
    // Take-home adds up with statements: received (2 ACME deposits = 5,300) + still expected (Co-op Nov + Dec = 5,300) = 10,600
    await expect(page.getByText(`${y} take-home`, { exact: true })).toBeVisible();
    await expect(page.getByText("$10,600.00").first()).toBeVisible();
    // ▸ opens a line's editor with labeled fields
    await page.getByRole("button", { name: "Edit Summer job" }).click();
    await expect(page.getByLabel("Income name")).toHaveValue("Summer job");
    // The budget is only your inputs: annual amount (spread evenly) or ▸ each month; no actuals mixed in.
    await expect(page.getByText(`${y} budget`, { exact: true })).toBeVisible();
    await expect(page.getByLabel("Rent annual", { exact: true })).toHaveValue("13200"); // 4 × 900 + 8 × 1,200
    await page.getByRole("button", { name: "Months for Rent" }).click();
    await expect(page.getByLabel("Rent Apr", { exact: true })).toHaveValue("900");
    await expect(page.getByLabel("Rent May", { exact: true })).toHaveValue("1200");
    await expect(page.getByText(/^actual \$/)).toHaveCount(0);
    // Save / invest inputs: annual spreads evenly
    await page.getByLabel("Save (cash) annual", { exact: true }).fill("1200");
    await page.getByLabel("Invest annual", { exact: true }).fill("600");
    await page.getByRole("button", { name: "Months for Save (cash)" }).click();
    await expect(page.getByLabel("Save (cash) Jan", { exact: true })).toHaveValue("100");
    await page.screenshot({ path: "test-results/finances.png", fullPage: true });
    await page.getByRole("button", { name: "Save & recalculate" }).click();
    await expect(page.getByText("All changes saved")).toBeVisible();
    // My plan: the year's goal and plan vs statements.
    await page.getByRole("button", { name: "My plan", exact: true }).click();
    await expect(page.getByText(`${y} goal: save + invest`)).toBeVisible();
    await expect(page.getByText("$1,800").first()).toBeVisible();
    await expect(page.getByText(`Plan vs statements, ${y}`)).toBeVisible();
    // One chart: money kept since Jan 1; the projection shows its parts
    await expect(page.getByText(`Checking balance, ${y}`)).toBeVisible();
    await expect(page.getByText(/paychecks after today − \$[\d,]+ budget for the rest of the year/)).toBeVisible();
    await expect(page.getByText("Within budget")).toBeVisible();
    await page.screenshot({ path: "test-results/plan.png", fullPage: true });
  } finally {
    await request.delete("/api/finances/export");
  }
});
