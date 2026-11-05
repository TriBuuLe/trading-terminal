import { rule, type RuleBook } from "./rules";

/** Registered-account rules engine. Pure functions; all limits come from the RuleBook (official sources). */

const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

// ---------------------------------------------------------------- Roth IRA

export type FilingStatus = "single" | "hoh" | "mfj" | "mfs";

export interface RothInput {
  taxYear: number;
  age: number; // age at the end of the tax year
  filingStatus: FilingStatus;
  magi: number;
  earnedIncome: number; // taxable compensation for the year
  otherIraContributions: number; // traditional + Roth for the same tax year (shared limit)
}

export interface RothLimit {
  base: number;
  limit: number;
  phaseOut: "none" | "partial" | "full";
  reasons: string[];
}

/**
 * Roth IRA contribution limit for a tax year, following IRS Pub 590-A
 * Worksheet 2-2: base limit (+ catch-up at 50), reduced in the MAGI phase-out
 * range (ratio rounded to 3 decimals, result rounded UP to the nearest $10,
 * minimum $200 if above zero), capped by taxable compensation and by other IRA
 * contributions for the same year.
 */
export function rothLimit(book: RuleBook, i: RothInput): RothLimit {
  const y = i.taxYear;
  const base = rule<number>(book, "US", y, "ira.limit") + (i.age >= 50 ? rule<number>(book, "US", y, "ira.catchup50") : 0);
  const key = i.filingStatus === "mfj" ? "roth.phaseout.mfj" : i.filingStatus === "mfs" ? "roth.phaseout.mfs" : "roth.phaseout.single";
  const [lo, hi] = rule<number[]>(book, "US", y, key) as [number, number];
  const reasons: string[] = [];
  let reduced = base;
  let phaseOut: RothLimit["phaseOut"] = "none";
  if (i.magi >= hi) {
    reduced = 0;
    phaseOut = "full";
    reasons.push(
      `Your MAGI (${i.magi.toLocaleString()}) is at or above the ${y} phase-out end (${hi.toLocaleString()}) for your filing status, so you can't contribute directly. The "backdoor Roth" is a topic to research with a tax professional (not automated here).`,
    );
  } else if (i.magi > lo) {
    const ratio = Math.min(1, Math.round(((i.magi - lo) / (hi - lo)) * 1000) / 1000);
    const step = rule<number>(book, "US", y, "roth.reduceRoundTo");
    const min = rule<number>(book, "US", y, "roth.reduceMinimum");
    reduced = Math.ceil((base - Math.round(ratio * base * 100) / 100) / step - 1e-9) * step;
    if (reduced > 0 && reduced < min) reduced = min;
    phaseOut = "partial";
    reasons.push(`MAGI is inside the ${y} phase-out range (${lo.toLocaleString()}–${hi.toLocaleString()}): limit reduced to ${reduced.toLocaleString()} (IRS Pub 590-A worksheet).`);
  }
  let limit = Math.min(reduced, Math.max(0, base - i.otherIraContributions));
  if (i.otherIraContributions > 0) reasons.push(`Other IRA contributions for ${y} (${i.otherIraContributions.toLocaleString()}) share the same annual limit.`);
  const compCap = Math.max(0, i.earnedIncome - i.otherIraContributions);
  if (compCap < limit) {
    limit = compCap;
    reasons.push(`Contributions can't exceed your taxable compensation (earned income) for ${y}: ${i.earnedIncome.toLocaleString()}.`);
  }
  return { base, limit: Math.max(0, r2(limit)), phaseOut, reasons };
}

export interface ContributionCheck {
  allowed: number;
  excess: number;
  excessTaxPerYear: number;
  ok: boolean;
  messages: string[];
}

/** Check a proposed Roth contribution against the limit and what's already in for that tax year. */
export function checkRothContribution(book: RuleBook, i: RothInput & { alreadyThisYear: number; amount: number }): ContributionCheck {
  const lim = rothLimit(book, { ...i });
  const room = Math.max(0, lim.limit - i.alreadyThisYear);
  const excess = r2(Math.max(0, i.amount - room));
  const pct = rule<number>(book, "US", i.taxYear, "ira.excessTaxPctPerYear");
  const messages = [...lim.reasons];
  if (excess > 0)
    messages.push(
      `This would be an excess contribution of ${excess.toLocaleString()}: the IRS taxes excess IRA contributions at ${pct}% per year (${r2((excess * pct) / 100).toLocaleString()}/yr) until removed.`,
    );
  return { allowed: r2(Math.min(i.amount, room)), excess, excessTaxPerYear: r2((excess * pct) / 100), ok: excess === 0, messages };
}

/** Contributions for tax year Y are allowed until the filing deadline in Y+1 (no extensions). April 15 used as the deadline. */
export function rothTaxYearsOpen(on: Date): number[] {
  const y = on.getUTCFullYear();
  const deadline = Date.UTC(y, 3, 15, 23, 59, 59); // April 15 (the actual due date can shift when it falls on a weekend/holiday)
  return on.getTime() <= deadline ? [y - 1, y] : [y];
}

/** 5-year rule: the period begins Jan 1 of the first tax year a Roth contribution was made for. */
export function fiveYearMet(firstContributionTaxYear: number | null, distributionYear: number): boolean {
  return firstContributionTaxYear !== null && distributionYear >= firstContributionTaxYear + 5;
}

export interface RothWithdrawal {
  fromContributions: number;
  fromEarnings: number;
  qualified: boolean;
  incomeTax: number;
  additionalTax: number;
  totalCost: number;
  explanation: string[];
}

/**
 * Withdrawal ordering (IRS Pub 590-B): regular contributions come out first
 * (always tax- and penalty-free), then earnings. Earnings are tax/penalty-free
 * only if qualified (age 59½ AND the 5-year period). Otherwise the earnings are
 * taxable income and, under 59½, also get the 10% additional tax. Exceptions
 * (first home, disability, etc.) are not modeled: they're listed for research.
 */
export function rothWithdrawal(
  book: RuleBook,
  i: { amount: number; contributionBasis: number; accountValue: number; age: number; year: number; firstContributionTaxYear: number | null; marginalTaxPct: number },
): RothWithdrawal {
  const amount = Math.min(i.amount, i.accountValue);
  const fromContributions = r2(Math.min(amount, i.contributionBasis));
  const fromEarnings = r2(amount - fromContributions);
  const qAge = rule<number>(book, "US", i.year, "roth.qualifiedAge");
  const ageOk = i.age >= qAge;
  const yearsOk = fiveYearMet(i.firstContributionTaxYear, i.year);
  const qualified = ageOk && yearsOk;
  const explanation = [`${fromContributions.toLocaleString()} comes from your contributions: always tax- and penalty-free.`];
  let incomeTax = 0;
  let additionalTax = 0;
  if (fromEarnings > 0) {
    if (qualified) explanation.push(`${fromEarnings.toLocaleString()} of earnings: qualified (age ${qAge}+ and the 5-year period met), so tax-free.`);
    else {
      incomeTax = r2((fromEarnings * i.marginalTaxPct) / 100);
      const why = [!ageOk && `you're under ${qAge}`, !yearsOk && `the 5-year period (from tax year ${i.firstContributionTaxYear ?? "—"}) isn't met until ${(i.firstContributionTaxYear ?? i.year) + 5}`].filter(Boolean).join(" and ");
      explanation.push(`${fromEarnings.toLocaleString()} of earnings is NOT qualified because ${why}: it's taxable income (~${incomeTax.toLocaleString()} at your ${i.marginalTaxPct}% rate).`);
      if (!ageOk) {
        const pct = rule<number>(book, "US", i.year, "roth.earlyAdditionalTaxPct");
        additionalTax = r2((fromEarnings * pct) / 100);
        explanation.push(`Plus the ${pct}% additional tax on early distributions: ${additionalTax.toLocaleString()}. Exceptions exist (e.g. first home up to $10,000, disability); research before relying on them.`);
      }
    }
  }
  return { fromContributions, fromEarnings, qualified, incomeTax, additionalTax, totalCost: r2(incomeTax + additionalTax), explanation };
}

// ---------------------------------------------------------------- TFSA

/**
 * TFSA room at the start of `year`: every annual dollar limit since the later
 * of 2009 and the year you turned 18 (resident), minus all contributions, plus
 * withdrawals from PRIOR years (added back on January 1 of the next year).
 */
export function tfsaRoom(
  book: RuleBook,
  i: { year: number; birthYear: number; contributionsByYear: Record<number, number>; withdrawalsByYear: Record<number, number> },
): { room: number; cumulativeLimits: number; contributed: number; addedBack: number } {
  const limits = rule<Record<string, number>>(book, "CA", 2026, "tfsa.limits");
  const ageStart = rule<number>(book, "CA", 2026, "tfsa.ageStart");
  const first = Math.max(2009, i.birthYear + ageStart);
  let cumulative = 0;
  for (let y = first; y <= i.year; y++) {
    const l = limits[String(y)];
    if (l === undefined) throw new Error(`No verified TFSA limit for ${y}`);
    cumulative += l;
  }
  const contributed = Object.entries(i.contributionsByYear).filter(([y]) => Number(y) <= i.year).reduce((a, [, v]) => a + v, 0);
  const addedBack = Object.entries(i.withdrawalsByYear).filter(([y]) => Number(y) < i.year).reduce((a, [, v]) => a + v, 0);
  return { room: r2(cumulative - contributed + addedBack), cumulativeLimits: cumulative, contributed: r2(contributed), addedBack: r2(addedBack) };
}

export function overContributionTaxPerMonth(excess: number, pctPerMonth: number) {
  return r2((Math.max(0, excess) * pctPerMonth) / 100);
}

// ---------------------------------------------------------------- RRSP

/** RRSP deduction limit = unused room + min(18% × last year's earned income, annual limit) − pension adjustment. */
export function rrspDeductionLimit(book: RuleBook, i: { year: number; unusedRoom: number; prevYearEarnedIncome: number; pensionAdjustment?: number }) {
  const pct = rule<number>(book, "CA", 2026, "rrsp.earnedIncomePct");
  const cap = rule<number>(book, "CA", i.year, "rrsp.limit");
  const newRoom = Math.max(0, Math.min((i.prevYearEarnedIncome * pct) / 100, cap) - (i.pensionAdjustment ?? 0));
  return { limit: r2(i.unusedRoom + newRoom), newRoom: r2(newRoom), cap };
}

/** RRSP over-contribution: 1%/month on the amount above the limit + $2,000 cushion. */
export function rrspExcess(book: RuleBook, contributions: number, limit: number) {
  const cushion = rule<number>(book, "CA", 2026, "rrsp.overCushion");
  const excess = Math.max(0, contributions - limit - cushion);
  return { excess: r2(excess), taxPerMonth: overContributionTaxPerMonth(excess, rule<number>(book, "CA", 2026, "rrsp.overTaxPctPerMonth")), cushion };
}

// ---------------------------------------------------------------- FHSA

/**
 * FHSA participation room for each year since opening: year 1 = $8,000; later
 * years = min($8,000 + carryforward, $40,000 − lifetime contributions), with
 * carryforward = the prior year's unused participation room, capped at $8,000.
 */
export function fhsaRoom(book: RuleBook, contributionsByAccountYear: number[]): { room: number; carryforward: number; lifetimeLeft: number; byYear: number[] } {
  const annual = rule<number>(book, "CA", 2026, "fhsa.annual");
  const lifetime = rule<number>(book, "CA", 2026, "fhsa.lifetime");
  const carryMax = rule<number>(book, "CA", 2026, "fhsa.carryMax");
  let carry = 0;
  let used = 0;
  const byYear: number[] = [];
  let room = 0;
  for (let k = 0; k < contributionsByAccountYear.length; k++) {
    room = Math.min(annual + carry, lifetime - used);
    byYear.push(r2(room));
    const c = contributionsByAccountYear[k] ?? 0;
    used += c;
    carry = Math.min(carryMax, Math.max(0, room - c));
  }
  return { room: r2(room - (contributionsByAccountYear.at(-1) ?? 0)), carryforward: carry, lifetimeLeft: r2(lifetime - used), byYear };
}

// ---------------------------------------------------------------- 401(k), HSA

export function k401Limit(book: RuleBook, year: number, age: number): number {
  const base = rule<number>(book, "US", year, "k401.deferral");
  if (age >= 60 && age <= 63) return base + rule<number>(book, "US", year, "k401.catchup60_63");
  if (age >= 50) return base + rule<number>(book, "US", year, "k401.catchup50");
  return base;
}

/** Employer match: matchPct% of salary, if you contribute at least that much. */
export function k401Match(salary: number, matchPctOfPay: number, yourContribution: number): number {
  return r2(Math.min(yourContribution, (salary * matchPctOfPay) / 100));
}

export function hsaLimit(book: RuleBook, year: number, coverage: "self" | "family", age: number): number {
  return rule<number>(book, "US", year, coverage === "self" ? "hsa.self" : "hsa.family") + (age >= 55 ? rule<number>(book, "US", year, "hsa.catchup55") : 0);
}

// ---------------------------------------------------------------- asset location

export type AssetClass = "us_equity" | "intl_equity" | "bonds" | "reit" | "cash";
export type TaxTreatment = "tax_free" | "tax_deferred" | "taxable";

export function treatment(type: string): TaxTreatment | null {
  if (["ROTH_IRA", "TFSA", "HSA", "FHSA"].includes(type)) return "tax_free";
  if (["TRADITIONAL_IRA", "401K", "RRSP"].includes(type)) return "tax_deferred";
  if (type === "TAXABLE") return "taxable";
  return null; // CASH / HISA: not part of the invested portfolio
}

// Preference order of account treatments per asset class (documented reasoning in REASONS).
const PREFS: Record<AssetClass, TaxTreatment[]> = {
  bonds: ["tax_deferred", "tax_free", "taxable"],
  reit: ["tax_deferred", "tax_free", "taxable"],
  us_equity: ["tax_free", "taxable", "tax_deferred"],
  intl_equity: ["taxable", "tax_free", "tax_deferred"],
  cash: ["taxable", "tax_deferred", "tax_free"],
};
const ORDER: AssetClass[] = ["bonds", "reit", "us_equity", "intl_equity", "cash"];

export const LOCATION_REASONS: Record<AssetClass, string> = {
  bonds: "Bond interest is taxed as ordinary income every year, so bonds go in tax-deferred accounts (RRSP / traditional IRA / 401(k)) first.",
  reit: "REIT distributions are mostly taxed as ordinary income: tax-deferred accounts first.",
  us_equity: "The highest expected long-term growth goes where growth is never taxed: Roth IRA / TFSA first; broad index ETFs are also tax-efficient in taxable accounts.",
  intl_equity:
    "Broad international index ETFs are tax-efficient in taxable accounts (and in the US you can claim the foreign tax credit there). In Canada: US-listed ETFs lose 15% US withholding on dividends inside a TFSA, but the treaty exempts RRSPs.",
  cash: "Cash yields little, so it goes wherever there's room left.",
};

export interface LocationResult {
  perAccount: { accountId: string; type: string; treatment: TaxTreatment; balance: number; holdings: Partial<Record<AssetClass, number>> }[];
  combined: Partial<Record<AssetClass, number>>;
  reasons: Record<AssetClass, string>;
}

/**
 * Asset location for the WHOLE household: dollars per asset class come from
 * the target allocation over all invested accounts combined, then each class
 * fills its preferred account types first (greedy, in ORDER).
 */
export function assetLocation(accounts: { id: string; type: string; balance: number }[], target: Partial<Record<AssetClass, number>>): LocationResult {
  const invested = accounts.filter((a) => treatment(a.type) !== null && a.balance > 0);
  const total = invested.reduce((s, a) => s + a.balance, 0);
  const free = new Map(invested.map((a) => [a.id, a.balance]));
  const holdings = new Map(invested.map((a) => [a.id, {} as Partial<Record<AssetClass, number>>]));
  const wsum = Object.values(target).reduce((a, b) => a + (b ?? 0), 0) || 1;
  for (const cls of ORDER) {
    let need = ((target[cls] ?? 0) / wsum) * total;
    for (const t of PREFS[cls]) {
      for (const a of invested.filter((x) => treatment(x.type) === t)) {
        if (need <= 0.005) break;
        const take = Math.min(need, free.get(a.id)!);
        if (take <= 0) continue;
        free.set(a.id, free.get(a.id)! - take);
        const h = holdings.get(a.id)!;
        h[cls] = r2((h[cls] ?? 0) + take);
        need -= take;
      }
    }
  }
  const combined: Partial<Record<AssetClass, number>> = {};
  for (const h of holdings.values()) for (const [k, v] of Object.entries(h) as [AssetClass, number][]) combined[k] = r2((combined[k] ?? 0) + v);
  return {
    perAccount: invested.map((a) => ({ accountId: a.id, type: a.type, treatment: treatment(a.type)!, balance: a.balance, holdings: holdings.get(a.id)! })),
    combined,
    reasons: LOCATION_REASONS,
  };
}

// ---------------------------------------------------------------- "Fund my Roth": proposed buys

export interface ProposedBuy {
  symbol: string;
  dollars: number;
  qty: number;
  price: number;
}

/**
 * Split new cash across target tickers to move the account toward its target
 * weights: fill the most underweight first (proportional to each deficit); any
 * cash beyond the total deficit is split by target weight. Shares are rounded
 * DOWN to 4 decimals so the cost never exceeds the cash.
 */
export function proposeBuys(
  cash: number,
  holdings: Record<string, number>, // current $ value per symbol
  weights: Record<string, number>, // target weight per symbol (sums to ~1)
  prices: Record<string, number>,
): { buys: ProposedBuy[]; leftover: number } {
  const syms = Object.keys(weights).filter((s) => weights[s]! > 0 && prices[s]! > 0);
  const wsum = syms.reduce((a, s) => a + weights[s]!, 0) || 1;
  const after = Object.values(holdings).reduce((a, b) => a + b, 0) + cash;
  const deficits = Object.fromEntries(syms.map((s) => [s, Math.max(0, (weights[s]! / wsum) * after - (holdings[s] ?? 0))]));
  const totalDef = Object.values(deficits).reduce((a, b) => a + b, 0);
  const alloc: Record<string, number> = {};
  if (totalDef >= cash) for (const s of syms) alloc[s] = totalDef > 0 ? (cash * deficits[s]!) / totalDef : 0;
  else for (const s of syms) alloc[s] = deficits[s]! + ((cash - totalDef) * weights[s]!) / wsum;
  const buys: ProposedBuy[] = [];
  let spent = 0;
  for (const s of syms) {
    const qty = Math.floor((alloc[s]! / prices[s]!) * 10_000) / 10_000;
    if (qty <= 0) continue;
    const dollars = r2(qty * prices[s]!);
    spent += dollars;
    buys.push({ symbol: s, dollars, qty, price: prices[s]! });
  }
  return { buys, leftover: r2(cash - spent) };
}
