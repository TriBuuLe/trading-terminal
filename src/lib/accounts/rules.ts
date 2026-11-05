/**
 * Year-versioned registered-account rules. Every value carries its official
 * source URL and the date it was read (2026-11-04). Seeded into the
 * `account_rules` table; the app warns when the current year's values are missing.
 * Never edit a value without re-reading the source.
 */
export interface RuleValue {
  year: number;
  jurisdiction: "US" | "CA";
  key: string;
  value: number | number[] | Record<string, number>;
  sourceUrl: string;
  quote: string;
  verifiedAt: string;
}

const V = "2026-11-04";
const IRS_2026 = "https://www.irs.gov/newsroom/401k-limit-increases-to-24500-for-2026-ira-limit-increases-to-7500";
const IRS_COLA = "https://www.irs.gov/retirement-plans/cola-increases-for-dollar-limitations-on-benefits-and-contributions";
const IRS_IRA = "https://www.irs.gov/retirement-plans/plan-participant-employee/retirement-topics-ira-contribution-limits";
const P590A = "https://www.irs.gov/publications/p590a";
const P590B = "https://www.irs.gov/publications/p590b";
const P969 = "https://www.irs.gov/publications/p969";
const CRA_TFSA_BEFORE = "https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/tax-free-savings-account/contributing/before.html";
const CRA_TFSA_OVER = "https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/tax-free-savings-account/contributing/overcontribute.html";
const CRA_TFSA_WD = "https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/tax-free-savings-account/withdraw.html";
const CRA_LIMITS = "https://www.canada.ca/en/revenue-agency/services/tax/registered-plans-administrators/pspa/mp-rrsp-dpsp-tfsa-limits-ympe.html";
const CRA_RRSP = "https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/rrsps-related-plans/contributing-a-rrsp-prpp/contributions-affect-your-rrsp-prpp-deduction-limit.html";
const CRA_RRSP_OVER = "https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/rrsps-related-plans/contributing-a-rrsp-prpp/what-happens-you-over-your-rrsp-prpp-deduction-limit.html";
const CRA_RRSP_DATES = "https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/rrsps-related-plans/important-dates-rrsp-rrif-rdsp.html";
const CRA_FHSA = "https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/first-home-savings-account/contributing-your-fhsa.html";
const CRA_FHSA_CLOSE = "https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/first-home-savings-account/closing-your-fhsa.html";
const CRA_FHSA_OVER = "https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/first-home-savings-account/what-happens-contribute-transfer-too-much.html";

const us = (year: number, key: string, value: RuleValue["value"], sourceUrl: string, quote: string): RuleValue => ({ year, jurisdiction: "US", key, value, sourceUrl, quote, verifiedAt: V });
const ca = (year: number, key: string, value: RuleValue["value"], sourceUrl: string, quote: string): RuleValue => ({ year, jurisdiction: "CA", key, value, sourceUrl, quote, verifiedAt: V });

/** TFSA dollar limits by year (CRA table). */
const TFSA_LIMITS: Record<string, number> = {
  "2009": 5000, "2010": 5000, "2011": 5000, "2012": 5000, "2013": 5500, "2014": 5500, "2015": 10000,
  "2016": 5500, "2017": 5500, "2018": 5500, "2019": 6000, "2020": 6000, "2021": 6000, "2022": 6000,
  "2023": 6500, "2024": 7000, "2025": 7000, "2026": 7000,
};

export const RULES: RuleValue[] = [
  // ---- US 2026 ----
  us(2026, "ira.limit", 7500, IRS_2026, "The limit on annual contributions to an IRA is increased to $7,500 from $7,000."),
  us(2026, "ira.catchup50", 1100, IRS_2026, "increased to $1,100, up from $1,000 for 2025"),
  us(2026, "roth.phaseout.single", [153000, 168000], IRS_2026, "between $153,000 and $168,000 for singles and heads of household"),
  us(2026, "roth.phaseout.mfj", [242000, 252000], IRS_2026, "the income phase-out range is increased to between $242,000 and $252,000"),
  us(2026, "roth.phaseout.mfs", [0, 10000], IRS_2026, "remains between $0 and $10,000"),
  us(2026, "k401.deferral", 24500, "https://www.irs.gov/retirement-plans/plan-participant-employee/retirement-topics-contributions", "The basic limit on elective deferrals is $24,500 in 2026"),
  us(2026, "k401.catchup50", 8000, IRS_COLA, "Catch-up contributions 8,000 (2026 column)"),
  us(2026, "k401.catchup60_63", 11250, IRS_COLA, "For 2026, this higher catch-up contribution limit is $11,250 (instead of $8,000)."),
  us(2026, "hsa.self", 4400, P969, "For 2026, if you have self-only HDHP coverage, you can contribute up to $4,400."),
  us(2026, "hsa.family", 8750, P969, "If you have family HDHP coverage, you can contribute up to $8,750."),
  us(2026, "hsa.catchup55", 1000, P969, "your contribution limit is increased by $1,000."),
  // ---- US 2025 (prior-tax-year contributions until the filing deadline) ----
  us(2025, "ira.limit", 7000, IRS_2026, "The limit on annual contributions to an IRA is increased to $7,500 from $7,000."),
  us(2025, "ira.catchup50", 1000, IRS_2026, "increased to $1,100, up from $1,000 for 2025"),
  us(2025, "roth.phaseout.single", [150000, 165000], P590A, "Table 2-1: at least $150,000 but less than $165,000 … $165,000 or more"),
  us(2025, "roth.phaseout.mfj", [236000, 246000], P590A, "Table 2-1: at least $236,000 but less than $246,000 … $246,000 or more"),
  us(2025, "roth.phaseout.mfs", [0, 10000], P590A, "Table 2-1: more than zero (-0-) but less than $10,000"),
  // ---- US rules that aren't dollar amounts (same for 2025/2026) ----
  ...[2025, 2026].flatMap((y) => [
    us(y, "ira.excessTaxPctPerYear", 6, IRS_IRA, "Excess contributions are taxed at 6% per year for each year the excess amounts remain in the IRA."),
    us(y, "roth.earlyAdditionalTaxPct", 10, P590B, "if you are under age 59½, you must pay a 10% additional tax on the distribution"),
    us(y, "roth.qualifiedAge", 59.5, P590B, "Made on or after the date you reach age 59½"),
    us(y, "roth.fiveYears", 5, P590B, "made after the 5-year period beginning with the first tax year for which a contribution was made to a Roth IRA"),
    us(y, "roth.reduceRoundTo", 10, P590A, "Round your reduced contribution limit up to the nearest $10."),
    us(y, "roth.reduceMinimum", 200, P590A, "If your reduced contribution limit is more than $0, but less than $200, increase the limit to $200."),
  ]),
  // ---- Canada ----
  ca(2026, "tfsa.limits", TFSA_LIMITS, CRA_TFSA_BEFORE, "2009 to 2012 $5,000 / 2013 and 2014 $5,500 / 2015 $10,000 / … / 2024 to 2026 $7,000"),
  ca(2026, "tfsa.ageStart", 18, CRA_TFSA_BEFORE, "your contribution room starts to accumulate when you turn 18 years of age."),
  ca(2026, "tfsa.overTaxPctPerMonth", 1, CRA_TFSA_OVER, "any excess amount in your TFSA is taxable at 1% per month for as long as it remains in your account."),
  ca(2026, "tfsa.withdrawalsBackNextYear", 1, CRA_TFSA_WD, "The amount you withdraw will only be added back as available contribution room on January 1 of the next calendar year."),
  ca(2025, "rrsp.limit", 32490, CRA_RRSP, "the annual RRSP limit (for 2025, the annual limit is $32,490)"),
  ca(2026, "rrsp.limit", 33810, CRA_LIMITS, "2026 … $33,810 (RRSP dollar limit)"),
  ca(2027, "rrsp.limit", 35390, CRA_LIMITS, "2027 … $35,390 (RRSP dollar limit)"),
  ca(2026, "rrsp.earnedIncomePct", 18, CRA_RRSP, "18% of your earned income in the previous year"),
  ca(2026, "rrsp.overCushion", 2000, CRA_RRSP_OVER, "exceed your RRSP deduction limit by more than $2,000"),
  ca(2026, "rrsp.overTaxPctPerMonth", 1, CRA_RRSP_OVER, "you have to pay a tax of 1% per month on your unused contributions that exceed your RRSP deduction limit by more than $2,000"),
  ca(2026, "rrsp.deadlineFor2025", [2026, 3, 2], CRA_RRSP_DATES, "March 2, 2026 is the deadline for contributing to an RRSP for the 2025 tax year."),
  ca(2026, "fhsa.annual", 8000, CRA_FHSA, "Your FHSA participation room in the year you open your first FHSA is $8,000."),
  ca(2026, "fhsa.lifetime", 40000, CRA_FHSA, "$40,000 minus all of your contributions to your FHSAs and transfers from your RRSPs"),
  ca(2026, "fhsa.carryMax", 8000, CRA_FHSA, "the lesser of: a) $8,000 … plus your FHSA participation room carryforward"),
  ca(2026, "fhsa.maxYears", 15, CRA_FHSA_CLOSE, "the 15th anniversary of opening your first FHSA"),
  ca(2026, "fhsa.maxAge", 71, CRA_FHSA_CLOSE, "you turn 71 years of age"),
  ca(2026, "fhsa.overTaxPctPerMonth", 1, CRA_FHSA_OVER, "you have to pay a tax of 1% per month on the highest excess FHSA amount in that month."),
];

export type RuleBook = Map<string, RuleValue>;

export function ruleBook(rows: RuleValue[]): RuleBook {
  return new Map(rows.map((r) => [`${r.jurisdiction}:${r.year}:${r.key}`, r]));
}

/** Look up a rule; throws a clear error if that year's value hasn't been verified. */
export function rule<T extends RuleValue["value"]>(book: RuleBook, j: "US" | "CA", year: number, key: string): T {
  const r = book.get(`${j}:${year}:${key}`);
  if (!r) throw new MissingRuleError(j, year, key);
  return r.value as T;
}

export class MissingRuleError extends Error {
  constructor(
    readonly jurisdiction: string,
    readonly year: number,
    readonly key: string,
  ) {
    super(`No verified ${jurisdiction} ${year} value for "${key}". Read the official source and add it to the rules table before relying on it.`);
    this.name = "MissingRuleError";
  }
}

export const defaultBook = () => ruleBook(RULES);
