import Decimal from "decimal.js";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { accountRules, mockAccounts, mockSchedules, mockTxns } from "@/db/schema";
import {
  assetLocation,
  fhsaRoom,
  hsaLimit,
  k401Limit,
  proposeBuys,
  rothLimit,
  rothTaxYearsOpen,
  rothWithdrawal,
  rrspDeductionLimit,
  tfsaRoom,
  type AssetClass,
  type ProposedBuy,
} from "@/lib/accounts/engine";
import { MissingRuleError, RULES, rule, ruleBook, type RuleBook, type RuleValue } from "@/lib/accounts/rules";
import { equityForRisk, riskScore } from "@/lib/planner/core";
import { derivedTaxFacts } from "@/lib/planner/net";
import type { Profile } from "@/lib/planner/types";
import { etParts } from "@/lib/time";
import { getSnapshots } from "./alpaca/market";
import { env } from "./env";
import { getProfile } from "./finances";
import { normalizeSnapshot } from "./quotes";

/**
 * Simulated broker for mock registered accounts. Trades fill at the REAL live
 * quote (Alpaca IEX) with SLIPPAGE_BPS against you. Everything is replayed from
 * an append-only ledger. Paper money: separate from the Alpaca trading sandbox.
 */

export type MockType = (typeof mockAccounts.$inferSelect)["type"];

/** US-listed building blocks (Alpaca only prices US-listed securities). */
export const CLASS_TICKER: Record<AssetClass, string> = { us_equity: "VTI", intl_equity: "VXUS", bonds: "BND", reit: "VNQ", cash: "SGOV" };

// ---------- rules ----------

declare global {
  var __paperTerminalRulesSeeded: boolean | undefined;
}

/** Seed/refresh the official rules table from the verified source file, then load it. */
export async function getRuleBook(): Promise<{ book: RuleBook; rows: RuleValue[] }> {
  if (!globalThis.__paperTerminalRulesSeeded) {
    for (const r of RULES) {
      await db()
        .insert(accountRules)
        .values({ ...r, value: r.value })
        .onConflictDoUpdate({
          target: [accountRules.jurisdiction, accountRules.year, accountRules.key],
          set: { value: r.value, sourceUrl: r.sourceUrl, quote: r.quote, verifiedAt: r.verifiedAt },
        });
    }
    globalThis.__paperTerminalRulesSeeded = true;
  }
  const rows = (await db().select().from(accountRules)) as RuleValue[];
  return { book: ruleBook(rows), rows };
}

export async function rulesStatus() {
  const { rows } = await getRuleBook();
  const year = Number(etParts(new Date()).date.slice(0, 4));
  const lastVerified = rows.reduce((m, r) => (r.verifiedAt > m ? r.verifiedAt : m), "");
  const missing: string[] = [];
  if (!rows.some((r) => r.jurisdiction === "US" && r.year === year && r.key === "ira.limit")) missing.push(`US ${year} IRA/Roth limits`);
  if (!rows.some((r) => r.jurisdiction === "CA" && r.year === year && r.key === "rrsp.limit")) missing.push(`CA ${year} RRSP limit`);
  const tfsa = rows.find((r) => r.key === "tfsa.limits");
  if (!tfsa || !(String(year) in (tfsa.value as Record<string, number>))) missing.push(`CA ${year} TFSA limit`);
  return { year, lastVerified, missing, rules: rows.sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction) || b.year - a.year || a.key.localeCompare(b.key)) };
}

// ---------- state ----------

export interface Holding {
  symbol: string;
  qty: string;
  price: number | null;
  value: number | null;
  costBasis: number;
}

export interface MockAccountState {
  id: number;
  type: MockType;
  name: string;
  openedAt: string;
  firstContributionTaxYear: number | null;
  cash: number;
  holdings: Holding[];
  value: number | null;
  contributionsByTaxYear: Record<number, number>;
  withdrawalsByYear: Record<number, number>;
  contributionBasis: number;
  netDeposits: number;
  gain: number | null;
  missingPrices: string[];
}

type Txn = typeof mockTxns.$inferSelect;

function replay(txns: Txn[]) {
  let cash = new Decimal(0);
  let basis = new Decimal(0);
  let deposits = new Decimal(0);
  const pos = new Map<string, { qty: Decimal; cost: Decimal }>();
  const contrib: Record<number, number> = {};
  const wd: Record<number, number> = {};
  for (const t of txns) {
    cash = cash.plus(t.cash);
    basis = basis.plus(t.basisDelta);
    if (t.kind === "contribution") {
      deposits = deposits.plus(t.cash);
      const y = t.taxYear ?? t.at.getUTCFullYear();
      contrib[y] = (contrib[y] ?? 0) + Number(t.cash);
    }
    if (t.kind === "withdrawal") {
      deposits = deposits.plus(t.cash);
      const y = t.at.getUTCFullYear();
      wd[y] = (wd[y] ?? 0) - Number(t.cash);
    }
    if ((t.kind === "buy" || t.kind === "sell") && t.symbol && t.qty) {
      const p = pos.get(t.symbol) ?? { qty: new Decimal(0), cost: new Decimal(0) };
      if (t.kind === "buy") {
        p.qty = p.qty.plus(t.qty);
        p.cost = p.cost.minus(t.cash); // cash is negative for buys
      } else {
        const avg = p.qty.isZero() ? new Decimal(0) : p.cost.div(p.qty);
        p.qty = p.qty.minus(t.qty);
        p.cost = p.cost.minus(avg.mul(t.qty));
      }
      if (p.qty.lte(0)) pos.delete(t.symbol);
      else pos.set(t.symbol, p);
    }
  }
  return { cash, basis, deposits, pos, contrib, wd };
}

export async function listAccounts(): Promise<MockAccountState[]> {
  const accts = await db().select().from(mockAccounts).where(isNull(mockAccounts.closedAt)).orderBy(asc(mockAccounts.id));
  const all = await db().select().from(mockTxns).orderBy(asc(mockTxns.at), asc(mockTxns.id));
  const replays = accts.map((a) => ({ a, r: replay(all.filter((t) => t.accountId === a.id)) }));
  const symbols = [...new Set(replays.flatMap(({ r }) => [...r.pos.keys()]))];
  const snaps = symbols.length ? await getSnapshots(symbols) : {};
  return replays.map(({ a, r }) => {
    const missing: string[] = [];
    let invested = new Decimal(0);
    const holdings: Holding[] = [...r.pos.entries()].map(([symbol, p]) => {
      const price = normalizeSnapshot(symbol, snaps[symbol]).price;
      if (price === null) missing.push(symbol);
      const value = price === null ? null : p.qty.mul(price).toNumber();
      if (value !== null) invested = invested.plus(value);
      return { symbol, qty: p.qty.toString(), price, value: value === null ? null : Math.round(value * 100) / 100, costBasis: p.cost.toDecimalPlaces(2).toNumber() };
    });
    const value = missing.length ? null : invested.plus(r.cash).toDecimalPlaces(2).toNumber();
    return {
      id: a.id,
      type: a.type,
      name: a.name,
      openedAt: a.openedAt.toISOString(),
      firstContributionTaxYear: a.firstContributionTaxYear,
      cash: r.cash.toDecimalPlaces(2).toNumber(),
      holdings,
      value,
      contributionsByTaxYear: r.contrib,
      withdrawalsByYear: r.wd,
      contributionBasis: r.basis.toDecimalPlaces(2).toNumber(),
      netDeposits: r.deposits.toDecimalPlaces(2).toNumber(),
      gain: value === null ? null : new Decimal(value).minus(r.deposits).toDecimalPlaces(2).toNumber(),
      missingPrices: missing,
    };
  });
}

export async function getAccountState(id: number): Promise<MockAccountState> {
  const s = (await listAccounts()).find((a) => a.id === id);
  if (!s) throw new Error("Account not found");
  return s;
}

export async function openAccount(type: MockType, name: string): Promise<number> {
  const [row] = await db().insert(mockAccounts).values({ type, name }).returning({ id: mockAccounts.id });
  return row!.id;
}

export async function closeAccount(id: number): Promise<void> {
  await db().update(mockAccounts).set({ closedAt: new Date() }).where(eq(mockAccounts.id, id));
}

// ---------- contribution rules ----------

export interface ContributionPreview {
  ok: boolean;
  allowed: number;
  room: number | null;
  excess: number;
  penalty: string | null;
  messages: string[];
  taxYearsOpen: number[];
  needsInfo: string[];
}

const year = () => Number(etParts(new Date()).date.slice(0, 4));

/** Check a contribution against that account type's official rules (preview; nothing is saved). */
export async function previewContribution(accountId: number, amount: number, taxYear?: number): Promise<ContributionPreview> {
  const { book } = await getRuleBook();
  const profile = await getProfile();
  // Typed-in tax facts win; otherwise use values derived from "before tax" income.
  const derived = profile ? derivedTaxFacts(profile, Number(etParts(new Date()).date.slice(0, 4))) : null;
  const tax = {
    ...(profile?.tax ?? {}),
    usEarnedIncome: profile?.tax?.usEarnedIncome ?? derived?.earnedIncome,
    magi: profile?.tax?.magi ?? derived?.magi,
    filingStatus: profile?.tax?.filingStatus ?? (derived ? ("single" as const) : undefined),
  };
  const acct = await getAccountState(accountId);
  const accts = await listAccounts();
  const now = new Date();
  const y = year();
  const age = profile?.age ?? 30;
  const needsInfo: string[] = [];
  const base = (room: number | null, messages: string[], penalty: string | null, years = [y]): ContributionPreview => {
    const excess = room === null ? 0 : Math.max(0, Math.round((amount - room) * 100) / 100);
    return { ok: excess === 0 && needsInfo.length === 0, allowed: room === null ? amount : Math.max(0, Math.min(amount, room)), room, excess, penalty: excess > 0 ? penalty : null, messages, taxYearsOpen: years, needsInfo };
  };
  try {
    switch (acct.type) {
      case "ROTH_IRA":
      case "TRADITIONAL_IRA": {
        const open = rothTaxYearsOpen(now);
        const ty = taxYear && open.includes(taxYear) ? taxYear : y;
        if (tax.usEarnedIncome === undefined) needsInfo.push("US earned income for the year");
        if (!tax.filingStatus) needsInfo.push("filing status");
        if (tax.magi === undefined) needsInfo.push("estimated MAGI");
        // The IRA limit is shared across ALL IRAs for the tax year.
        const already = accts.filter((a) => a.type === "ROTH_IRA" || a.type === "TRADITIONAL_IRA").reduce((s, a) => s + (a.contributionsByTaxYear[ty] ?? 0), 0);
        const lim = rothLimit(book, {
          taxYear: ty,
          age,
          filingStatus: tax.filingStatus ?? "single",
          // Traditional IRA contributions have no income limit (only deductibility does, which isn't modeled).
          magi: acct.type === "ROTH_IRA" ? (tax.magi ?? 0) : 0,
          earnedIncome: tax.usEarnedIncome ?? 0,
          otherIraContributions: 0,
        });
        const room = Math.max(0, lim.limit - already);
        const msgs = [...lim.reasons, `${ty} IRA limit for you: ${lim.limit.toLocaleString()} (shared by all your IRAs); already contributed ${already.toLocaleString()}.`];
        if (acct.type === "TRADITIONAL_IRA") msgs.push("Deductibility of traditional IRA contributions isn't modeled.");
        const pct = rule<number>(book, "US", ty, "ira.excessTaxPctPerYear");
        const excess = Math.max(0, amount - room);
        return base(room, msgs, `${pct}% per year (${(Math.round(excess * pct) / 100).toLocaleString()}/yr) until removed`, open);
      }
      case "TFSA": {
        const birthYear = tax.birthYear ?? y - age;
        const r = tfsaRoom(book, { year: y, birthYear, contributionsByYear: acct.contributionsByTaxYear, withdrawalsByYear: acct.withdrawalsByYear });
        const room = tax.tfsaRoomOverride != null ? tax.tfsaRoomOverride - (acct.contributionsByTaxYear[y] ?? 0) : r.room;
        return base(
          room,
          [
            tax.tfsaRoomOverride != null
              ? `Using the TFSA room you entered from CRA (${tax.tfsaRoomOverride.toLocaleString()}) minus this year's mock contributions.`
              : `TFSA room ${room.toLocaleString()}: limits since you turned 18 (${r.cumulativeLimits.toLocaleString()}) − mock contributions (${r.contributed.toLocaleString()}) + prior-year withdrawals (${r.addedBack.toLocaleString()}). Real contributions elsewhere aren't counted: set your CRA room in Tax facts.`,
            "Withdrawals are added back to your room on January 1 of next year, not right away.",
          ],
          "1% per month on the excess while it stays in",
        );
      }
      case "RRSP": {
        if (tax.caPrevYearEarnedIncome === undefined) needsInfo.push("last year's earned income (Canada)");
        const lim = rrspDeductionLimit(book, { year: y, unusedRoom: tax.rrspUnusedRoom ?? 0, prevYearEarnedIncome: tax.caPrevYearEarnedIncome ?? 0 });
        const room = Math.max(0, lim.limit - (acct.contributionsByTaxYear[y] ?? 0));
        return base(room + 2000, [`RRSP deduction limit ${lim.limit.toLocaleString()} (unused room + 18% of last year's earned income, max ${lim.cap.toLocaleString()}). CRA allows a $2,000 over-contribution cushion; beyond it, 1% per month.`], "1% per month on the excess above the $2,000 cushion");
      }
      case "FHSA": {
        const opened = new Date(acct.openedAt).getUTCFullYear();
        const years = Array.from({ length: y - opened + 1 }, (_, i) => acct.contributionsByTaxYear[opened + i] ?? 0);
        const r = fhsaRoom(book, years);
        return base(Math.max(0, r.room), [`FHSA room this year ${r.room.toLocaleString()} ($8,000/yr + up to $8,000 carryforward; ${r.lifetimeLeft.toLocaleString()} of the $40,000 lifetime limit left).`], "1% per month on the highest excess in the month");
      }
      case "401K": {
        const lim = k401Limit(book, y, age);
        return base(Math.max(0, lim - (acct.contributionsByTaxYear[y] ?? 0)), [`Employee deferral limit ${y}: ${lim.toLocaleString()}${age >= 50 ? " (incl. catch-up)" : ""}.`], "excess deferrals are taxed twice unless corrected by April 15");
      }
      case "HSA": {
        if (!tax.hsaCoverage || tax.hsaCoverage === "none") needsInfo.push("HDHP coverage (self or family); without an HDHP you can't contribute to an HSA");
        const lim = hsaLimit(book, y, tax.hsaCoverage === "family" ? "family" : "self", age);
        return base(Math.max(0, lim - (acct.contributionsByTaxYear[y] ?? 0)), [`HSA limit ${y}: ${lim.toLocaleString()}.`], "6% excise tax per year on the excess");
      }
      case "TAXABLE":
        return base(null, ["No contribution limit for a taxable account."], null);
    }
  } catch (e) {
    if (e instanceof MissingRuleError) return { ok: false, allowed: 0, room: 0, excess: 0, penalty: null, messages: [e.message], taxYearsOpen: [y], needsInfo };
    throw e;
  }
}

export async function contribute(accountId: number, amount: number, opts: { taxYear?: number; acceptExcess?: boolean; source?: string } = {}) {
  if (!(amount > 0)) throw new Error("Amount must be positive");
  const p = await previewContribution(accountId, amount, opts.taxYear);
  if (p.needsInfo.length) throw new Error(`Add your tax facts first: ${p.needsInfo.join(", ")}.`);
  if (p.excess > 0 && !opts.acceptExcess) throw new Error(`That's ${p.excess.toLocaleString()} over the limit (${p.penalty}). Lower the amount, or confirm the excess explicitly.`);
  const acct = await getAccountState(accountId);
  const ty = acct.type === "ROTH_IRA" || acct.type === "TRADITIONAL_IRA" ? (opts.taxYear && p.taxYearsOpen.includes(opts.taxYear) ? opts.taxYear : year()) : year();
  await db().insert(mockTxns).values({ accountId, kind: "contribution", taxYear: ty, cash: amount.toFixed(2), basisDelta: acct.type === "ROTH_IRA" ? amount.toFixed(2) : "0", note: p.excess > 0 ? `EXCESS ${p.excess}` : null, source: opts.source ?? "manual" });
  if (acct.type === "ROTH_IRA" || acct.type === "FHSA") {
    // Roth 5-year clock / FHSA participation start: first contribution's tax year (earliest wins).
    await db()
      .update(mockAccounts)
      .set({ firstContributionTaxYear: sql`least(coalesce(${mockAccounts.firstContributionTaxYear}, ${ty}), ${ty})` })
      .where(eq(mockAccounts.id, accountId));
  }
  return { taxYear: ty, preview: p };
}

// ---------- trading ----------

async function livePrice(symbol: string, side: "buy" | "sell") {
  const q = normalizeSnapshot(symbol, (await getSnapshots([symbol], { fresh: true }))[symbol]);
  // Use the quote side when it's sane (within 2% of last), else the last trade.
  const quote = side === "buy" ? q.ask : q.bid;
  const ref = quote && q.price && Math.abs(quote - q.price) / q.price < 0.02 ? quote : q.price;
  if (!ref) throw new Error(`No live price for ${symbol}`);
  const bps = env().SLIPPAGE_BPS / 10_000;
  return { quote: ref, fill: side === "buy" ? ref * (1 + bps) : ref * (1 - bps) };
}

export async function trade(accountId: number, symbol: string, side: "buy" | "sell", qty: number, source = "manual") {
  if (!(qty > 0)) throw new Error("Quantity must be positive");
  const acct = await getAccountState(accountId);
  const { quote, fill } = await livePrice(symbol, side);
  const cost = new Decimal(qty).mul(fill).toDecimalPlaces(2);
  if (side === "buy" && cost.gt(acct.cash + 0.005)) throw new Error(`Not enough cash: need ${cost.toFixed(2)}, have ${acct.cash.toFixed(2)}. Contribute first.`);
  if (side === "sell") {
    const h = acct.holdings.find((x) => x.symbol === symbol);
    if (!h || new Decimal(h.qty).lt(qty)) throw new Error(`You hold ${h?.qty ?? 0} ${symbol}`);
  }
  await db().insert(mockTxns).values({
    accountId,
    kind: side,
    symbol,
    qty: String(qty),
    price: fill.toFixed(6),
    quotePrice: quote.toFixed(6),
    cash: (side === "buy" ? cost.neg() : cost).toFixed(2),
    source,
  });
  return { fill, quote, cost: cost.toNumber() };
}

// ---------- withdrawals ----------

export async function previewWithdrawal(accountId: number, amount: number) {
  const acct = await getAccountState(accountId);
  const profile = await getProfile();
  const y = year();
  if (acct.type !== "ROTH_IRA") {
    const notes: Record<string, string> = {
      TFSA: "TFSA withdrawals are tax-free; the amount is added back to your room on January 1 of next year.",
      RRSP: "RRSP withdrawals are taxable income, and the bank withholds tax at source. The room is NOT restored.",
      FHSA: "Qualifying first-home withdrawals are tax-free; other withdrawals are taxable income.",
      TRADITIONAL_IRA: "Traditional IRA withdrawals are taxable income; under 59½ there's generally a 10% additional tax.",
      "401K": "401(k) withdrawals are taxable income; under 59½ there's generally a 10% additional tax.",
      HSA: "HSA withdrawals for qualified medical expenses are tax-free; other withdrawals are taxed (plus 20% under 65).",
      TAXABLE: "Selling in a taxable account can realize capital gains.",
    };
    return { cashAvailable: acct.cash, explanation: [notes[acct.type] ?? ""], cost: null as null | number };
  }
  const { book } = await getRuleBook();
  const w = rothWithdrawal(book, {
    amount,
    contributionBasis: acct.contributionBasis,
    accountValue: acct.value ?? acct.cash,
    age: profile?.age ?? 30,
    year: y,
    firstContributionTaxYear: acct.firstContributionTaxYear,
    marginalTaxPct: profile?.tax?.marginalTaxPct ?? (profile ? derivedTaxFacts(profile, y)?.marginalPct : undefined) ?? 22,
  });
  return { cashAvailable: acct.cash, explanation: w.explanation, cost: w.totalCost, detail: w };
}

export async function withdraw(accountId: number, amount: number) {
  const acct = await getAccountState(accountId);
  if (!(amount > 0)) throw new Error("Amount must be positive");
  if (amount > acct.cash + 0.005) throw new Error(`Only ${acct.cash.toFixed(2)} cash available: sell holdings first.`);
  const fromBasis = acct.type === "ROTH_IRA" ? Math.min(amount, acct.contributionBasis) : 0;
  const pv = await previewWithdrawal(accountId, amount);
  await db().insert(mockTxns).values({ accountId, kind: "withdrawal", cash: (-amount).toFixed(2), basisDelta: (-fromBasis).toFixed(2), note: pv.cost ? `est. tax+penalty ${pv.cost}` : null });
  return pv;
}

// ---------- asset location + "Fund my Roth" ----------

/** Household target by asset class from the plan's risk profile (stocks split 60% US / 40% international). */
export function householdTarget(profile: Profile | null): Partial<Record<AssetClass, number>> {
  const eq = equityForRisk(profile ? (profile.riskOverride ?? riskScore(profile.risk)) : 6);
  return { us_equity: Math.round(eq * 0.6 * 1000) / 1000, intl_equity: Math.round(eq * 0.4 * 1000) / 1000, bonds: Math.round((1 - eq) * 1000) / 1000 };
}

export async function householdLocation(extra?: { accountId: number; amount: number }) {
  const profile = await getProfile();
  const accts = await listAccounts();
  const target = householdTarget(profile);
  const loc = assetLocation(
    accts.map((a) => ({ id: String(a.id), type: a.type, balance: (a.value ?? a.cash) + (extra && extra.accountId === a.id ? extra.amount : 0) })),
    target,
  );
  return { target, loc, accounts: accts };
}

/** Propose exact buys for `amount` of new money in an account, keeping the household on target. */
export async function proposeFund(accountId: number, amount: number): Promise<{ buys: ProposedBuy[]; leftover: number; weights: Record<string, number>; contribution: ContributionPreview }> {
  const contribution = await previewContribution(accountId, amount);
  const { loc, accounts } = await householdLocation({ accountId, amount });
  const acct = accounts.find((a) => a.id === accountId)!;
  const mine = loc.perAccount.find((p) => p.accountId === String(accountId));
  const classes = (mine?.holdings ?? {}) as Partial<Record<AssetClass, number>>;
  const total = Object.values(classes).reduce((a, b) => a + (b ?? 0), 0) || 1;
  const weights: Record<string, number> = {};
  for (const [cls, v] of Object.entries(classes) as [AssetClass, number][]) weights[CLASS_TICKER[cls]] = (weights[CLASS_TICKER[cls]] ?? 0) + v / total;
  const syms = Object.keys(weights);
  const prices: Record<string, number> = {};
  for (const s of syms) prices[s] = (await livePrice(s, "buy")).fill;
  const current = Object.fromEntries(acct.holdings.map((h) => [h.symbol, h.value ?? 0]));
  return { ...proposeBuys(amount + acct.cash, current, weights, prices), weights, contribution };
}

export async function executeFund(accountId: number, amount: number, opts: { taxYear?: number; source?: string } = {}) {
  await contribute(accountId, amount, { taxYear: opts.taxYear, source: opts.source ?? "fund" });
  const plan = await proposeFund(accountId, 0);
  const done: { symbol: string; qty: number; cost: number }[] = [];
  for (const b of plan.buys) {
    try {
      const r = await trade(accountId, b.symbol, "buy", b.qty, opts.source ?? "fund");
      done.push({ symbol: b.symbol, qty: b.qty, cost: r.cost });
    } catch {
      // Price moved up between proposal and fill: buy slightly less.
      const q = Math.floor(b.qty * 0.99 * 10_000) / 10_000;
      if (q > 0) {
        const r = await trade(accountId, b.symbol, "buy", q, opts.source ?? "fund");
        done.push({ symbol: b.symbol, qty: q, cost: r.cost });
      }
    }
  }
  return done;
}

// ---------- schedules (auto-contribution) ----------

export async function listSchedules() {
  return db().select().from(mockSchedules).orderBy(asc(mockSchedules.id));
}

export async function addSchedule(accountId: number, amount: number, dayOfMonth: number) {
  const [row] = await db().insert(mockSchedules).values({ accountId, amount: amount.toFixed(2), dayOfMonth }).returning();
  return row!;
}

/** Cron: run each active schedule once per month on/after its day. Idempotent via lastRunMonth. */
export async function runSchedules(): Promise<string[]> {
  const today = etParts(new Date()).date;
  const month = today.slice(0, 7);
  const day = Number(today.slice(8, 10));
  const out: string[] = [];
  for (const s of await listSchedules()) {
    if (!s.active || s.lastRunMonth === month || day < s.dayOfMonth) continue;
    // Claim the month first so a double cron run can't contribute twice.
    const claimed = await db()
      .update(mockSchedules)
      .set({ lastRunMonth: month })
      .where(and(eq(mockSchedules.id, s.id), sql`${mockSchedules.lastRunMonth} is distinct from ${month}`))
      .returning({ id: mockSchedules.id });
    if (!claimed.length) continue;
    try {
      const pv = await previewContribution(s.accountId, Number(s.amount));
      const amt = pv.room === null ? Number(s.amount) : Math.min(Number(s.amount), Math.max(0, pv.room));
      if (amt <= 0) {
        out.push(`schedule ${s.id}: skipped, no contribution room left`);
        continue;
      }
      const buys = await executeFund(s.accountId, amt, { source: "schedule" });
      out.push(`schedule ${s.id}: contributed ${amt.toFixed(2)}, bought ${buys.map((b) => `${b.qty} ${b.symbol}`).join(", ") || "nothing"}`);
    } catch (e) {
      out.push(`schedule ${s.id}: failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}
