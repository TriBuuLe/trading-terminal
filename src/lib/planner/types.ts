/** Financial-planner domain types. All money is in dollars of the stated currency. */

export type Country = "CA" | "US";
export type Frequency = "hourly" | "weekly" | "biweekly" | "semimonthly" | "monthly" | "annual";
export type YearMonth = string; // "YYYY-MM"

export interface IncomeStream {
  id: string;
  name: string;
  /** Amount per pay period (or per hour). Take-home unless basis is "gross". */
  amount: number;
  frequency: Frequency;
  /** For hourly pay. */
  hoursPerWeek?: number;
  /** "net" = take-home (default); "gross" = before tax: the app estimates taxes. */
  basis?: "net" | "gross";
  kind: "salary" | "coop" | "bonus" | "other";
  /** Active window (inclusive). Co-op terms vs school terms are separate streams with windows. */
  startMonth?: YearMonth | null;
  endMonth?: YearMonth | null;
  /** Expected yearly raise, % (applied each January after the start year). */
  annualRaisePct?: number;
  /** Same calendar months every year (e.g. a Sep–Dec co-op term each fall). */
  repeatsYearly?: boolean;
  /**
   * Exact schedule (weekly / biweekly, or hourly paid weekly / biweekly): one paycheck
   * every `payDay` (0 = Sunday … 5 = Friday), so a month with 5 Fridays gets 5.
   * Dates are YYYY-MM-DD and override startMonth/endMonth when set.
   */
  employmentStart?: string | null;
  employmentEnd?: string | null;
  /** Known first / last paycheck; otherwise derived from the employment dates. */
  firstPayDate?: string | null;
  lastPayDate?: string | null;
  payDay?: number;
  /** For hourly pay: how often you're paid. */
  payEvery?: "weekly" | "biweekly";
  /** Days you work (0 = Sunday … 6 = Saturday); default Mon–Fri. Used for partial periods and hourly pay. */
  workdays?: number[];
  /** The pay period ends this many days before payday (0 = on payday). */
  periodEndsDaysBefore?: number;
}

export interface Expense {
  id: string;
  category: string;
  monthly: number;
  kind: "need" | "want";
  /** Optional date range (e.g. a 4-month lease). Several lines can share a category. */
  startMonth?: YearMonth | null;
  endMonth?: YearMonth | null;
  repeatsYearly?: boolean;
}

export interface Debt {
  id: string;
  name: string;
  balance: number;
  aprPct: number;
  minPayment: number;
}

export type AccountType =
  | "CASH"
  | "HISA"
  | "TFSA"
  | "RRSP"
  | "FHSA"
  | "ROTH_IRA"
  | "TRADITIONAL_IRA"
  | "401K"
  | "HSA"
  | "TAXABLE";

export interface AssetAccount {
  id: string;
  name: string;
  type: AccountType;
  balance: number;
}

export type GoalKind = "emergency" | "car" | "house" | "retirement" | "long_term" | "education" | "other";

export interface Goal {
  id: string;
  name: string;
  kind: GoalKind;
  target: number; // today's dollars
  targetDate: YearMonth;
  priority: number; // 1 = highest
  /** Money already set aside for this goal. */
  current: number;
}

export interface RiskAnswers {
  horizonYears: number; // years until most of the money is needed
  drawdownReaction: 1 | 2 | 3 | 4; // 1 sell everything … 4 buy more
  incomeStability: 1 | 2 | 3; // 1 unstable/irregular … 3 very stable
  experience: 1 | 2 | 3; // 1 none … 3 experienced
}

export interface Profile {
  country: Country;
  region: string; // province/state
  age: number;
  /** May move between Canada and the US, or holds accounts in both. */
  crossBorder: boolean;
  incomes: IncomeStream[];
  expenses: Expense[];
  debts: Debt[];
  accounts: AssetAccount[];
  goals: Goal[];
  risk: RiskAnswers;
  riskOverride?: number | null; // 1..10
  /** Employer retirement match: % of salary matched, if any. */
  employerMatchPct?: number;
  /** Share of investable money allowed for individual stock picking (%). */
  sandboxPct: number;
  /** Debts at or above this APR count as high-interest. */
  highInterestAprPct: number;
  /** Tax facts for account eligibility (encrypted with the rest of the profile). */
  tax?: TaxFacts;
  /** Plan with the typed-in budget, or with actual spending from imported transactions. */
  budgetBasis?: "planned" | "actual";
  /** Transaction category → budget line (empty string = don't map). */
  categoryMap?: Record<string, string>;
  /** Your own category rules for transactions (see MyRules in csv.ts). */
  categoryRules?: { match: string; category: string }[];
  peerOutCategory?: string;
  /** Monthly automatic balance updates (income in, spending and debt payments out). */
  autoRoll?: { enabled: boolean; cashAccountId: string; lastRolledMonth: YearMonth };
}

export interface TaxFacts {
  /** US: does the user have US earned income (compensation) this year? */
  usEarnedIncome?: number;
  filingStatus?: "single" | "hoh" | "mfj" | "mfs";
  magi?: number;
  /** Marginal income-tax rate %, used to estimate tax on non-qualified withdrawals. */
  marginalTaxPct?: number;
  hsaCoverage?: "self" | "family" | "none";
  /** Canada: last year's earned income and unused RRSP room (from your notice of assessment). */
  caPrevYearEarnedIncome?: number;
  rrspUnusedRoom?: number;
  /** Real TFSA contributions/withdrawals outside this app, if any (from CRA My Account). */
  tfsaRoomOverride?: number | null;
  birthYear?: number;
  /** Pre-tax payroll deductions per year (traditional 401(k), health premiums): lower income tax, not FICA. */
  pretaxAnnual?: number;
  /** Your own flat state income-tax estimate (%) for states without verified rules. */
  stateRatePct?: number | null;
}

export interface AssetClassAssumption {
  key: "equity" | "bonds" | "cash";
  label: string;
  realReturnPct: number; // expected real (after-inflation) geometric annual return
  volatilityPct: number; // annual standard deviation
  source: string;
}

export interface Assumptions {
  inflationPct: number;
  inflationSource: string;
  classes: Record<"equity" | "bonds" | "cash", AssetClassAssumption>;
  stockBondCorrelation: number;
  correlationSource: string;
}
