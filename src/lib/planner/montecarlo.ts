import type { Assumptions } from "./types";

/** Seeded PRNG (mulberry32): same seed ⇒ same simulation, so results are reproducible and testable. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal pair via Box–Muller. */
function normals(rand: () => number): [number, number] {
  let u = 0;
  while (u === 0) u = rand();
  const v = rand();
  const r = Math.sqrt(-2 * Math.log(u));
  return [r * Math.cos(2 * Math.PI * v), r * Math.sin(2 * Math.PI * v)];
}

export interface Mix {
  equity: number;
  bonds: number;
  cash: number;
}

export interface SimInput {
  current: number;
  monthlyContribution: number;
  months: number;
  /** Asset mix as a function of months remaining (glide path). */
  mixAt: (monthsLeft: number) => Mix;
  assumptions: Assumptions;
  runs?: number;
  seed?: number;
  target?: number;
}

export interface SimResult {
  runs: number;
  p10: number;
  p50: number;
  p90: number;
  /** Probability the ending value reaches `target` (null if no target). */
  probability: number | null;
  /** Yearly percentile bands (index 0 = start), in real dollars. */
  bands: { year: number; p10: number; p50: number; p90: number }[];
}

const pct = (sorted: Float64Array, p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))]!;

/**
 * Monte Carlo in REAL (inflation-adjusted) dollars. Each asset class gets a
 * monthly lognormal return: log-mean ln(1+g)/12 (g = assumed real geometric
 * return) and log-sd σ/√12. Stocks and bonds are correlated (ρ from
 * assumptions); cash is independent. Contributions are added at month end and
 * the portfolio is rebalanced monthly to the glide-path mix.
 */
export function simulate(input: SimInput): SimResult {
  const runs = input.runs ?? 5000;
  const rand = rng(input.seed ?? 42);
  const a = input.assumptions;
  const mu = {
    equity: Math.log(1 + a.classes.equity.realReturnPct / 100) / 12,
    bonds: Math.log(1 + a.classes.bonds.realReturnPct / 100) / 12,
    cash: Math.log(1 + a.classes.cash.realReturnPct / 100) / 12,
  };
  const sd = {
    equity: a.classes.equity.volatilityPct / 100 / Math.sqrt(12),
    bonds: a.classes.bonds.volatilityPct / 100 / Math.sqrt(12),
    cash: a.classes.cash.volatilityPct / 100 / Math.sqrt(12),
  };
  const rho = a.stockBondCorrelation;
  const k = Math.sqrt(1 - rho * rho);
  const years = Math.floor(input.months / 12);
  const finals = new Float64Array(runs);
  const yearly = Array.from({ length: years + 1 }, () => new Float64Array(runs));
  // Pre-compute the glide path once.
  const mixes = Array.from({ length: input.months }, (_, m) => input.mixAt(input.months - m));

  for (let r = 0; r < runs; r++) {
    let v = input.current;
    yearly[0]![r] = v;
    for (let m = 0; m < input.months; m++) {
      const [z1, z2] = normals(rand);
      const [z3] = normals(rand);
      const mix = mixes[m]!;
      const re = Math.exp(mu.equity + sd.equity * z1);
      const rb = Math.exp(mu.bonds + sd.bonds * (rho * z1 + k * z2));
      const rc = Math.exp(mu.cash + sd.cash * z3);
      v = v * (mix.equity * re + mix.bonds * rb + mix.cash * rc) + input.monthlyContribution;
      if ((m + 1) % 12 === 0) yearly[(m + 1) / 12]![r] = v;
    }
    finals[r] = v;
  }
  finals.sort();
  for (const y of yearly) y.sort();
  const target = input.target;
  let probability: number | null = null;
  if (target !== undefined) {
    let hit = 0;
    for (const f of finals) if (f >= target) hit++;
    probability = hit / runs;
  }
  return {
    runs,
    p10: pct(finals, 0.1),
    p50: pct(finals, 0.5),
    p90: pct(finals, 0.9),
    probability,
    bands: yearly.map((y, i) => ({ year: i, p10: pct(y, 0.1), p50: pct(y, 0.5), p90: pct(y, 0.9) })),
  };
}

/**
 * Smallest monthly contribution that reaches `target` with probability ≥ `p`
 * (e.g. 0.8 = 80% of simulated markets), following the same glide path as the
 * odds shown. Every evaluation reuses the same seed (common random numbers), so
 * probability is monotonic in the contribution and bisection is exact to a cent.
 */
export function requiredForProbability(i: Omit<SimInput, "monthlyContribution"> & { target: number; p: number }): number {
  const prob = (pmt: number) => simulate({ ...i, monthlyContribution: pmt, runs: i.runs ?? 1000, seed: i.seed ?? 99 }).probability ?? 0;
  if (prob(0) >= i.p) return 0;
  let lo = 0;
  let hi = Math.max(1, (i.target - i.current) / Math.max(1, i.months));
  for (let k = 0; k < 20 && prob(hi) < i.p; k++) hi *= 2;
  while (hi - lo > 0.01) {
    const mid = (lo + hi) / 2;
    if (prob(mid) >= i.p) hi = mid;
    else lo = mid;
  }
  return Math.ceil(hi * 100) / 100;
}

/** Expected real geometric return of a mix (for deterministic contribution math). */
export function expectedReturnPct(mix: Mix, a: Assumptions): number {
  return mix.equity * a.classes.equity.realReturnPct + mix.bonds * a.classes.bonds.realReturnPct + mix.cash * a.classes.cash.realReturnPct;
}
