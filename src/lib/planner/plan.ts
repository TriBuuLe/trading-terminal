import {
  averageIncome,
  incomeTimeline,
  cashFlow,
  cutSuggestions,
  emergencyFundTarget,
  equityForRisk,
  goalMix,
  horizonBand,
  monthsBetween,
  overrideWarning,
  payoff,
  requiredMonthly,
  riskScore,
  round2,
  type CashFlow,
  type HorizonBand,
  type PayoffResult,
} from "./core";
import { expectedReturnPct, simulate, type Mix, type SimResult } from "./montecarlo";
import type { AccountType, Assumptions, Country, Goal, Profile, YearMonth } from "./types";

/** Which account a goal's money should live in (defaults; the advisor explains them). */
export function accountForGoal(country: Country, goal: Goal, band: HorizonBand, annualIncome: number): { type: AccountType; why: string } {
  if (goal.kind === "emergency" || band === "short") {
    return {
      type: "HISA",
      why: "Money needed within ~3 years belongs in cash: a high-interest savings account, GICs/CDs or T-bills. Stocks can be down 30% exactly when you need it.",
    };
  }
  if (country === "CA") {
    if (goal.kind === "house") return { type: "FHSA", why: "FHSA: contributions are deductible AND qualifying first-home withdrawals are tax-free. Use it before the TFSA for a first home." };
    if (goal.kind === "retirement" && annualIncome >= 60_000)
      return { type: "RRSP", why: "RRSP: at your income the deduction now is likely worth more than the tax on withdrawal in retirement." };
    return { type: "TFSA", why: "TFSA: growth and withdrawals are tax-free and the room comes back the following year; the default home for long-term money at lower incomes." };
  }
  if (goal.kind === "retirement" || goal.kind === "long_term") {
    return { type: "ROTH_IRA", why: "Roth IRA: growth is tax-free in retirement. Take any 401(k) employer match first (free money)." };
  }
  return { type: "TAXABLE", why: "A taxable brokerage account with broad, tax-efficient index ETFs." };
}

export interface WaterfallStep {
  key: "starter_ef" | "match" | "high_interest_debt" | "full_ef" | "goals" | "invest";
  label: string;
  monthly: number;
  status: "done" | "active" | "waiting";
  note: string;
}

export interface GoalPlan {
  goal: Goal;
  monthsLeft: number;
  yearsLeft: number;
  band: HorizonBand;
  mix: Mix;
  expectedRealReturnPct: number;
  account: { type: AccountType; why: string };
  requiredMonthly: number;
  allocatedMonthly: number;
  onTrack: boolean;
  sim: SimResult;
}

export interface Plan {
  asOf: YearMonth;
  realDollars: true;
  monthlyIncome: number;
  /** Income month by month for the next 12 months (what the average is made of). */
  incomeByMonth: { month: YearMonth; amount: number }[];
  cashFlow: CashFlow;
  savingsTarget: number;
  cuts: { category: string; cut: number }[];
  emergency: { months: number; full: number; starter: number; current: number };
  risk: { score: number; effective: number; warning: string | null; equityLong: number };
  debt: { avalanche: PayoffResult; snowball: PayoffResult; interestSavedVsSnowball: number; highInterest: string[] } | null;
  waterfall: WaterfallStep[];
  goals: GoalPlan[];
  netWorth: { current: number; sim: SimResult; years: number };
  sandbox: { pct: number; monthly: number };
  crossBorderWarning: string | null;
  /** Can this month's savings fund every goal on time? */
  feasibility: { needed: number; available: number; shortfall: number; message: string };
}

const usd = (x: number) => `$${round2(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const CROSS_BORDER =
  "Cross-border caution: Canada and the US tax each other's accounts differently. A TFSA isn't tax-sheltered for US taxpayers, Canadian ETFs/mutual funds can fall under US PFIC rules, and Roth IRAs are treated differently depending on residency. Talk to a cross-border tax professional before acting; this plan does not model it.";

/**
 * Build the whole plan. Deterministic given (profile, assumptions, asOf, seed).
 * Every number the AI advisor quotes must come from here.
 */
export function buildPlan(p: Profile, a: Assumptions, asOf: YearMonth, opts: { runs?: number; seed?: number } = {}): Plan {
  const runs = opts.runs ?? 5000;
  const seed = opts.seed ?? 42;
  const income = averageIncome(p.incomes, asOf, 12);
  const cf = cashFlow(income, p.expenses, p.debts);
  const score = riskScore(p.risk);
  const effective = p.riskOverride ?? score;
  const equityLong = equityForRisk(effective);

  const essentials = cf.needs + cf.debtMinimums;
  const ef = emergencyFundTarget(essentials, p.risk.incomeStability);
  const efGoal = p.goals.find((g) => g.kind === "emergency");
  const efCurrent = (efGoal?.current ?? 0) + p.accounts.filter((x) => x.type === "CASH" || x.type === "HISA").reduce((s, x) => s + x.balance, 0);

  // Goal requirements (real dollars).
  const goalPlans: GoalPlan[] = [];
  for (const g of [...p.goals].sort((x, y) => x.priority - y.priority)) {
    const monthsLeft = Math.max(1, monthsBetween(asOf, g.targetDate));
    const yearsLeft = monthsLeft / 12;
    const band = horizonBand(yearsLeft);
    const mix = goalMix(yearsLeft, equityLong);
    const er = expectedReturnPct(mix, a);
    const current = g.kind === "emergency" ? efCurrent : g.current;
    goalPlans.push({
      goal: { ...g, current },
      monthsLeft,
      yearsLeft: round2(yearsLeft),
      band,
      mix,
      expectedRealReturnPct: round2(er),
      account: accountForGoal(p.country, g, band, income * 12),
      requiredMonthly: requiredMonthly(g.target, current, monthsLeft, er),
      allocatedMonthly: 0,
      onTrack: false,
      sim: null as unknown as SimResult,
    });
  }

  // Priority waterfall for THIS month's savings.
  let left = Math.max(0, cf.available);
  const steps: WaterfallStep[] = [];
  const take = (want: number) => {
    const x = Math.max(0, Math.min(left, want));
    left -= x;
    return round2(x);
  };
  const starterGap = Math.max(0, ef.starter - efCurrent);
  steps.push({
    key: "starter_ef",
    label: "Starter emergency fund",
    monthly: take(starterGap),
    status: starterGap <= 0 ? "done" : "active",
    note: `Target ${round2(ef.starter)} (one month of essentials, at least $1,000).`,
  });
  const matchNeed = p.employerMatchPct ? income * (p.employerMatchPct / 100) : 0;
  steps.push({
    key: "match",
    label: "Employer match",
    monthly: take(matchNeed),
    status: matchNeed > 0 ? "active" : "done",
    note: matchNeed > 0 ? `Contribute enough to get the full ${p.employerMatchPct}% match: an instant 100% return.` : "No employer match entered.",
  });
  const high = p.debts.filter((d) => d.balance > 0 && d.aprPct >= p.highInterestAprPct);
  const highNeed = high.reduce((s, d) => s + d.balance, 0);
  steps.push({
    key: "high_interest_debt",
    label: "High-interest debt (avalanche)",
    monthly: take(highNeed),
    status: high.length ? "active" : "done",
    note: high.length ? `Extra payments to ${[...high].sort((x, y) => y.aprPct - x.aprPct)[0]!.name} first (highest rate).` : `No debt at or above ${p.highInterestAprPct}% APR.`,
  });
  const fullGap = Math.max(0, ef.full - Math.max(efCurrent, ef.starter));
  steps.push({
    key: "full_ef",
    label: `Full emergency fund (${ef.months} months)`,
    monthly: take(fullGap),
    status: fullGap <= 0 ? "done" : "active",
    note: `Target ${ef.full}: ${ef.months} months of essentials, scaled by income stability.`,
  });
  let goalsMonthly = 0;
  for (const gp of goalPlans) {
    if (gp.goal.kind === "emergency") {
      gp.allocatedMonthly = round2((steps[0]!.monthly + steps[3]!.monthly));
      continue;
    }
    gp.allocatedMonthly = take(gp.requiredMonthly);
    goalsMonthly += gp.allocatedMonthly;
  }
  steps.push({
    key: "goals",
    label: "Goals (by priority, in the account each one needs)",
    monthly: round2(goalsMonthly),
    status: goalPlans.some((g) => g.goal.kind !== "emergency") ? "active" : "done",
    note: "Each goal gets the monthly amount that reaches its target on time at its expected return.",
  });
  const invest = round2(left);
  steps.push({
    key: "invest",
    label: "Long-term investing (tax-advantaged first, then taxable)",
    monthly: take(invest),
    status: invest > 0 ? "active" : "waiting",
    note: `Diversified index ETFs at ${Math.round(equityLong * 100)}% stocks.`,
  });

  // Simulate each goal with what it's actually getting.
  for (const [i, gp] of goalPlans.entries()) {
    const monthly = gp.allocatedMonthly;
    gp.sim = simulate({
      current: gp.goal.current,
      monthlyContribution: monthly,
      months: gp.monthsLeft,
      mixAt: (m) => goalMix(m / 12, equityLong),
      assumptions: a,
      runs,
      seed: seed + i,
      target: gp.goal.target,
    });
    gp.onTrack = monthly + 0.005 >= gp.requiredMonthly;
  }

  // Debt strategies.
  let debt: Plan["debt"] = null;
  if (p.debts.some((d) => d.balance > 0)) {
    const extra = steps[2]!.monthly;
    const av = payoff(p.debts, extra, "avalanche");
    const sb = payoff(p.debts, extra, "snowball");
    debt = { avalanche: av, snowball: sb, interestSavedVsSnowball: round2(sb.totalInterest - av.totalInterest), highInterest: high.map((d) => d.name) };
  }

  // Net worth: everything invested at the long-run mix, with this month's total savings, 30 years.
  const assets = p.accounts.reduce((s, x) => s + x.balance, 0);
  const debts = p.debts.reduce((s, d) => s + d.balance, 0);
  const nwYears = 30;
  const totalSaving = Math.max(0, cf.available);
  const nw = simulate({
    current: assets - debts,
    monthlyContribution: totalSaving,
    months: nwYears * 12,
    mixAt: () => ({ equity: equityLong, bonds: 1 - equityLong, cash: 0 }),
    assumptions: a,
    runs: Math.min(runs, 5000),
    seed: seed + 1000,
  });

  const goalNeed = round2(goalPlans.reduce((s, g) => s + g.requiredMonthly, 0));
  const savingsTarget = round2(Math.max(cf.guideline.savings, goalNeed));
  const avail = Math.max(0, cf.available);
  const shortfall = round2(Math.max(0, goalNeed - avail));
  const behind = goalPlans.filter((g) => !g.onTrack).map((g) => g.goal.name);
  const feasibility = {
    needed: goalNeed,
    available: round2(avail),
    shortfall,
    message:
      shortfall <= 0
        ? "Your savings cover every goal on schedule."
        : cf.available < 0
          ? `You're spending ${usd(-cf.available)}/month more than your average income (${usd(cf.income)}), so nothing goes to goals yet (they need ${usd(goalNeed)}/month). ` +
            "Check that all your future income is entered (next terms, summer jobs, full-time work), then look at spending."
          : `Your goals need ${usd(goalNeed)}/month but ${usd(avail)} is available: ${usd(shortfall)}/month short. ` +
          `Behind: ${behind.join(", ")}. Options: cut spending, push target dates out, lower targets, or raise income. Higher-priority goals are funded first.`,
  };
  return {
    asOf,
    realDollars: true,
    monthlyIncome: round2(income),
    incomeByMonth: incomeTimeline(p.incomes, asOf, 12),
    cashFlow: cf,
    savingsTarget,
    cuts: cutSuggestions(p.expenses, savingsTarget - Math.max(0, cf.available)),
    emergency: { ...ef, current: round2(efCurrent) },
    risk: { score, effective, warning: overrideWarning(p.risk, p.riskOverride), equityLong: round2(equityLong) },
    debt,
    waterfall: steps,
    goals: goalPlans,
    netWorth: { current: round2(assets - debts), sim: nw, years: nwYears },
    sandbox: { pct: p.sandboxPct, monthly: round2((steps[5]!.monthly * p.sandboxPct) / 100) },
    crossBorderWarning: p.crossBorder ? CROSS_BORDER : null,
    feasibility,
  };
}
