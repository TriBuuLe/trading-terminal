import { taxRulesFor, type Bracket, type FilingStatus } from "./rules";

/**
 * Gross wages → estimated take-home for one calendar year: federal income tax
 * (standard deduction + brackets), Social Security (up to the wage base),
 * Medicare (+ Additional Medicare over the threshold), and state income tax
 * where we have verified rules. This is the tax you OWE for the year; paycheck
 * withholding can differ (a short co-op term often gets a refund).
 * Not modeled: credits, itemizing, local taxes, self-employment tax.
 */
const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

export function bracketTax(taxable: number, brackets: Bracket[]): { tax: number; marginalPct: number } {
  let tax = 0;
  let prev = 0;
  let marginal = brackets[0]![1];
  for (const [upTo, rate] of brackets) {
    if (taxable <= prev) break;
    const slice = Math.min(taxable, upTo) - prev;
    tax += (slice * rate) / 100;
    marginal = rate;
    prev = upTo;
  }
  return { tax: r2(tax), marginalPct: taxable > 0 ? marginal : brackets[0]![1] };
}

export interface YearTax {
  year: number;
  gross: number;
  pretaxDeductions: number;
  agi: number;
  federalTaxable: number;
  federal: number;
  socialSecurity: number;
  medicare: number;
  additionalMedicare: number;
  state: number | null;
  stateName: string | null;
  net: number;
  effectivePct: number;
  marginalPct: number; // federal marginal + state rate (+ FICA isn't included)
  notes: string[];
}

export function yearTax(i: {
  year: number;
  grossWages: number;
  filingStatus: FilingStatus;
  state: string;
  /** Traditional 401(k)/403(b) and similar: reduce federal + state taxable wages, not FICA. */
  pretaxDeductions?: number;
  /** For states without verified rules: the user's own flat estimate (%). */
  stateRateOverridePct?: number | null;
}): YearTax {
  const { rules, note } = taxRulesFor(i.year);
  const notes: string[] = note ? [note] : [];
  const gross = Math.max(0, i.grossWages);
  const pretax = Math.min(gross, Math.max(0, i.pretaxDeductions ?? 0));
  const agi = gross - pretax;
  const fs = i.filingStatus;
  const federalTaxable = Math.max(0, agi - rules.federal.standardDeduction[fs]);
  const fed = bracketTax(federalTaxable, rules.federal.brackets[fs]);
  const f = rules.fica;
  const socialSecurity = r2((Math.min(gross, f.socialSecurityWageBase) * f.socialSecurityPct) / 100);
  const medicare = r2((gross * f.medicarePct) / 100);
  const additionalMedicare = r2((Math.max(0, gross - f.additionalMedicareThreshold[fs]) * f.additionalMedicarePct) / 100);

  const st = rules.states[i.state.toUpperCase()];
  let state: number | null = null;
  let stateRate = 0;
  if (st) {
    const stTaxable = Math.max(0, agi - st.standardDeduction[fs]);
    state = r2((stTaxable * st.ratePct) / 100);
    stateRate = stTaxable > 0 ? st.ratePct : 0;
    if (st.standardDeductionYear !== rules.year) notes.push(`${st.name}: ${rules.year} standard deduction not published yet; using ${st.standardDeductionYear}.`);
  } else if (i.stateRateOverridePct != null) {
    state = r2((agi * i.stateRateOverridePct) / 100);
    stateRate = i.stateRateOverridePct;
    notes.push(`State tax uses your ${i.stateRateOverridePct}% estimate (no verified rules for ${i.state || "your state"}).`);
  } else {
    notes.push(`State income tax isn't modeled for ${i.state || "your state"} yet: enter a state rate estimate in Tax facts, or it's treated as $0.`);
  }
  const total = fed.tax + socialSecurity + medicare + additionalMedicare + (state ?? 0);
  const net = r2(gross - pretax - total);
  return {
    year: i.year,
    gross: r2(gross),
    pretaxDeductions: r2(pretax),
    agi: r2(agi),
    federalTaxable: r2(federalTaxable),
    federal: fed.tax,
    socialSecurity,
    medicare,
    additionalMedicare,
    state,
    stateName: st?.name ?? (i.stateRateOverridePct != null ? i.state : null),
    net,
    effectivePct: gross > 0 ? r2((total / gross) * 100) : 0,
    marginalPct: r2(fed.marginalPct + stateRate),
    notes,
  };
}
