import { simulate, type Mix } from "../planner/montecarlo";
import type { Assumptions } from "../planner/types";

/**
 * What a tax-free wrapper (Roth IRA / TFSA) is worth: the same contributions
 * and mix projected (a) tax-free and (b) in a taxable account, where dividends
 * are taxed every year (a drag of yield × dividend tax rate on the return) and
 * the remaining gain is taxed at the end (capital-gains rate). Tax rates are
 * the user's estimates, not facts; everything is in today's dollars.
 */
export interface WrapperInput {
  current: number;
  monthly: number;
  years: number;
  mix: Mix;
  assumptions: Assumptions;
  dividendYieldPct: number;
  dividendTaxPct: number;
  capitalGainsTaxPct: number;
  runs?: number;
  seed?: number;
}

export function wrapperValue(i: WrapperInput) {
  const months = Math.round(i.years * 12);
  const base = { current: i.current, monthlyContribution: i.monthly, months, mixAt: () => i.mix, runs: i.runs ?? 5000, seed: i.seed ?? 7 };
  const taxFree = simulate({ ...base, assumptions: i.assumptions });
  const drag = (i.dividendYieldPct * i.dividendTaxPct) / 100; // % of return lost each year
  const a = i.assumptions;
  const dragged: Assumptions = {
    ...a,
    classes: {
      equity: { ...a.classes.equity, realReturnPct: a.classes.equity.realReturnPct - drag },
      bonds: { ...a.classes.bonds, realReturnPct: a.classes.bonds.realReturnPct - (a.classes.bonds.realReturnPct + a.inflationPct) * (i.dividendTaxPct / 100) },
      cash: { ...a.classes.cash, realReturnPct: a.classes.cash.realReturnPct - (a.classes.cash.realReturnPct + a.inflationPct) * (i.dividendTaxPct / 100) },
    },
  };
  const taxable = simulate({ ...base, assumptions: dragged });
  const contributed = i.current + i.monthly * months;
  const afterCg = (v: number) => v - Math.max(0, v - contributed) * (i.capitalGainsTaxPct / 100);
  return {
    contributed,
    taxFreeP50: taxFree.p50,
    taxableP50AfterTax: afterCg(taxable.p50),
    wrapperWorth: taxFree.p50 - afterCg(taxable.p50),
    taxFreeBands: taxFree.bands,
    taxFree,
  };
}
