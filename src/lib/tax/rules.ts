/**
 * Payroll / income-tax rules for turning gross pay into take-home pay.
 * Every value was read from the official source on the date shown; never edit
 * a number without re-reading its source.
 */
export type FilingStatus = "single" | "hoh" | "mfj" | "mfs";
export type Bracket = [upTo: number, ratePct: number]; // last bracket upTo = Infinity

export interface TaxYearRules {
  year: number;
  federal: {
    brackets: Record<FilingStatus, Bracket[]>;
    standardDeduction: Record<FilingStatus, number>;
    sources: { brackets: string; standardDeduction: string };
  };
  fica: {
    socialSecurityPct: number;
    socialSecurityWageBase: number;
    medicarePct: number;
    additionalMedicarePct: number;
    additionalMedicareThreshold: Record<FilingStatus, number>;
    sources: { rates: string; additional: string };
  };
  states: Record<string, StateRules>;
  verifiedAt: string;
}

export interface StateRules {
  name: string;
  kind: "flat";
  ratePct: number;
  standardDeduction: Record<FilingStatus, number>;
  /** Set when the deduction is carried from an earlier year because this year's isn't published yet. */
  standardDeductionYear: number;
  sources: { rate: string; standardDeduction: string };
  notes: string[];
}

const RP_2025_32 = "https://www.irs.gov/pub/irs-drop/rp-25-32.pdf";
const IR_2025_103 = "https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill";
const TC751 = "https://www.irs.gov/taxtopics/tc751";
const TC560 = "https://www.irs.gov/taxtopics/tc560";
const NC_RATE = "https://www.ncdor.gov/taxes-forms/tax-rate-schedules";
const NC_STD = "https://www.ncdor.gov/taxes-forms/individual-income-tax/filing-topics/north-carolina-standard-deduction-or-north-carolina-itemized-deductions";

const I = Infinity;

export const TAX_YEARS: Record<number, TaxYearRules> = {
  2026: {
    year: 2026,
    federal: {
      // Rev. Proc. 2025-32, §4.01 Tables 1–4 (taxable income thresholds).
      brackets: {
        single: [[12_400, 10], [50_400, 12], [105_700, 22], [201_775, 24], [256_225, 32], [640_600, 35], [I, 37]],
        mfj: [[24_800, 10], [100_800, 12], [211_400, 22], [403_550, 24], [512_450, 32], [768_700, 35], [I, 37]],
        hoh: [[17_700, 10], [67_450, 12], [105_700, 22], [201_750, 24], [256_200, 32], [640_600, 35], [I, 37]],
        mfs: [[12_400, 10], [50_400, 12], [105_700, 22], [201_775, 24], [256_225, 32], [384_350, 35], [I, 37]],
      },
      // "the standard deduction rises to $16,100 … $32,200 for married couples filing jointly … heads of households … $24,150"
      standardDeduction: { single: 16_100, mfs: 16_100, mfj: 32_200, hoh: 24_150 },
      sources: { brackets: RP_2025_32, standardDeduction: IR_2025_103 },
    },
    fica: {
      // "The current tax rate for Social Security is 6.2% … for the employee … For earnings in 2026, this base limit is $184,500."
      socialSecurityPct: 6.2,
      socialSecurityWageBase: 184_500,
      // "The current rate for Medicare is 1.45% … for the employee"
      medicarePct: 1.45,
      // "A 0.9% Additional Medicare tax applies … $250,000 for married filing jointly; $125,000 for married filing separately; $200,000 for all other taxpayers"
      additionalMedicarePct: 0.9,
      additionalMedicareThreshold: { single: 200_000, hoh: 200_000, mfj: 250_000, mfs: 125_000 },
      sources: { rates: TC751, additional: TC560 },
    },
    states: {
      NC: {
        name: "North Carolina",
        kind: "flat",
        // "For Taxable Years after 2025, the North Carolina individual income tax rate is 3.99% (0.0399)."
        ratePct: 3.99,
        // NCDOR has only published the 2025 standard deduction so far.
        standardDeduction: { single: 12_750, mfs: 12_750, mfj: 25_500, hoh: 19_125 },
        standardDeductionYear: 2025,
        sources: { rate: NC_RATE, standardDeduction: NC_STD },
        notes: [
          "NC taxable income starts from federal adjusted gross income (NCDOR).",
          "NC's 2026 standard deduction isn't published yet; using the 2025 amount.",
        ],
      },
    },
    verifiedAt: "2026-11-05",
  },
};

/** Rules for a year, falling back to the latest verified year (with a note). */
export function taxRulesFor(year: number): { rules: TaxYearRules; note: string | null } {
  if (TAX_YEARS[year]) return { rules: TAX_YEARS[year]!, note: null };
  const years = Object.keys(TAX_YEARS).map(Number).sort((a, b) => a - b);
  const pick = [...years].reverse().find((y) => y <= year) ?? years[0]!;
  return { rules: TAX_YEARS[pick]!, note: `${year} tax tables aren't published/verified yet; estimating with ${pick} rules.` };
}
