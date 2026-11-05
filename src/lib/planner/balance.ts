import { round2 } from "./core";

/**
 * Checking balance over time, rebuilt from your statements: start from a balance
 * the bank printed (the "Running Bal." / "Ending balance" in a Bank of America CSV)
 * and add / subtract every checking-account transaction before or after it.
 * Card purchases don't touch checking until the card is paid, so only checking
 * rows count (ACH "DES:" lines, Zelle, debit-card "PURCHASE", Mobile Banking, ATM,
 * bank fees, wires, Remitly).
 */
export interface BalanceAnchor {
  date: string; // YYYY-MM-DD, balance at the END of this day
  balance: number;
  source: "statement";
}

export interface BalanceTx {
  date: string;
  description: string;
  amount: number;
}

export const CHECKING_ROW = /DES:|Zelle|\bPURCHASE\b|Mobile Banking|BKOFAMERICA ATM|INTERNATIONAL TRANSACTION FEE|WIRE TYPE|Online Banking|RMTLY|PMNT SENT/i;

/** Balance at the end of `date`, from the anchor and the checking rows in between. */
export function balanceOn(date: string, anchor: BalanceAnchor, txs: BalanceTx[]): number {
  const chk = txs.filter((t) => CHECKING_ROW.test(t.description));
  const between = (a: string, b: string) => chk.filter((t) => t.date > a && t.date <= b).reduce((s, t) => s + t.amount, 0);
  return round2(date <= anchor.date ? anchor.balance - between(date, anchor.date) : anchor.balance + between(anchor.date, date));
}

/** Month-end balances for the year up to the last imported transaction (null after it, or before the data starts). */
export function monthEndBalances(year: number, anchor: BalanceAnchor | null, txs: BalanceTx[]): (number | null)[] {
  if (!anchor) return Array.from({ length: 12 }, () => null);
  const first = txs.map((t) => t.date).sort()[0] ?? anchor.date;
  const last = txs.map((t) => t.date).sort().at(-1) ?? anchor.date;
  return Array.from({ length: 12 }, (_, k) => {
    const end = new Date(Date.UTC(year, k + 1, 0)).toISOString().slice(0, 10);
    const d = end > last ? last : end;
    if (d < first || `${year}-${String(k + 1).padStart(2, "0")}` > last.slice(0, 7)) return null;
    return balanceOn(d, anchor, txs);
  });
}

/** The newest balance a Bank of America CSV states: the last "Running Bal." row, or "Ending balance as of MM/DD/YYYY". */
export function statementBalance(grid: string[][]): BalanceAnchor | null {
  const num = (s: string | undefined) => (s && /\d/.test(s) ? Number(s.replace(/[^0-9.-]/g, "")) : null);
  const iso = (s: string) => {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s.trim());
    return m ? `${m[3]}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}` : null;
  };
  let best: BalanceAnchor | null = null;
  const consider = (date: string | null, balance: number | null) => {
    if (date && balance !== null && Number.isFinite(balance) && (!best || date >= best.date)) best = { date, balance: round2(balance), source: "statement" };
  };
  const headerAt = grid.findIndex((r) => r.some((c) => /running bal/i.test(c)));
  if (headerAt >= 0) {
    const col = grid[headerAt]!.findIndex((c) => /running bal/i.test(c));
    for (const r of grid.slice(headerAt + 1)) consider(iso(r[0] ?? ""), num(r[col]));
  }
  for (const r of grid) {
    const m = /ending balance as of (\d{1,2}\/\d{1,2}\/\d{4})/i.exec(r[0] ?? "");
    if (m) consider(iso(m[1]!), num(r.find((c, k) => k > 0 && /\d/.test(c))));
  }
  return best;
}
