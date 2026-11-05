import { describe, expect, it } from "vitest";
import { balanceOn, monthEndBalances, statementBalance } from "@/lib/planner/balance";
import { parseCsv } from "@/lib/planner/csv";

// From a real Bank of America layout (amounts as in the statement)
const csv = [
  "Description,,Summary Amt.",
  'Beginning balance as of 09/25/2026,,"901.62"',
  'Ending balance as of 10/26/2026,,"3,769.60"',
  "",
  "Date,Description,Amount,Running Bal.",
  '09/25/2026,Beginning balance as of 09/25/2026,,"901.62"',
  '09/25/2026,"IBM 3141 DES:PAYROLL ID:1","1,325.48","2,227.10"',
  '09/28/2026,"Zelle payment to Sam","-41.85","2,185.25"',
  '10/26/2026,"UBER *EATS HELP.U 10/25 PURCHASE","-26.77","3,769.60"',
].join("\n");

describe("checking balance from statements", () => {
  it("reads the bank's own balance from a Bank of America CSV", () => {
    expect(statementBalance(parseCsv(csv))).toEqual({ date: "2026-10-26", balance: 3769.6, source: "statement" });
  });
  it("rebuilds earlier balances from checking rows only (card purchases don't touch checking)", () => {
    const anchor = { date: "2026-10-26", balance: 3769.6, source: "statement" as const };
    const txs = [
      { date: "2026-09-25", description: "IBM 3141 DES:PAYROLL", amount: 1325.48 },
      { date: "2026-09-28", description: "Zelle payment to Sam", amount: -41.85 },
      { date: "2026-10-02", description: "AplPay TARGET DURHAM NC", amount: -61.43 }, // Amex card: not checking
      { date: "2026-10-09", description: "IBM 3141 DES:PAYROLL", amount: 1325.47 },
      { date: "2026-10-26", description: "UBER *EATS HELP.U 10/25 PURCHASE", amount: -26.77 },
    ];
    // Sep 28 = 3,769.60 − (1,325.47 − 26.77) = 2,470.90; Sep 24 = 2,470.90 − 1,325.48 + 41.85 = 1,187.27
    expect(balanceOn("2026-09-28", anchor, txs)).toBe(2470.9);
    expect(balanceOn("2026-09-24", anchor, txs)).toBe(1187.27);
    const m = monthEndBalances(2026, anchor, txs);
    expect(m[8]).toBe(2470.9); // Sep 30
    expect(m[9]).toBe(3769.6); // Oct (data ends Oct 26)
    expect(m[10]).toBeNull(); // no data yet
  });
});
