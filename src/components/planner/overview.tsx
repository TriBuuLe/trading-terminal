"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Circle, CircleDot, ExternalLink } from "lucide-react";
import { useState } from "react";
import { Area, ComposedChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { feeDrag } from "@/lib/planner/core";
import type { Plan } from "@/lib/planner/plan";
import { fundsForMix } from "@/lib/planner/portfolios";
import type { Assumptions, Country } from "@/lib/planner/types";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorState, LoadingRows, Tag } from "../terminal/bits";

const SERIES = { needs: "#3987e5", wants: "#d95926", debt: "#c98500", savings: "#199e70" };

function Card({ title, children, className, right }: { title: string; children: React.ReactNode; className?: string; right?: React.ReactNode }) {
  return (
    <section className={cn("min-w-0 rounded-md border border-border bg-background/40 p-3", className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-background/40 px-3 py-2">
      <div className="text-[10px] tracking-wider text-muted-foreground uppercase">{label}</div>
      <div className="num mt-0.5 text-lg leading-tight">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** Stacked bar with 2px gaps + legend; the 50/30/20 guideline drawn underneath for comparison. */
function CashFlowBar({ plan }: { plan: Plan }) {
  const cf = plan.cashFlow;
  const savings = Math.max(0, cf.available);
  const parts = [
    { k: "needs", label: "Needs", v: cf.needs, color: SERIES.needs },
    { k: "wants", label: "Wants", v: cf.wants, color: SERIES.wants },
    { k: "debt", label: "Debt minimums", v: cf.debtMinimums, color: SERIES.debt },
    { k: "savings", label: "Left to save", v: savings, color: SERIES.savings },
  ];
  const total = Math.max(cf.income, parts.reduce((a, p) => a + p.v, 0)) || 1;
  const g = cf.guideline;
  return (
    <div className="space-y-2">
      <div className="flex h-5 w-full gap-[2px] overflow-hidden rounded">
        {parts.map((p) =>
          p.v > 0 ? <div key={p.k} title={`${p.label}: ${money(p.v)} (${((p.v / cf.income) * 100).toFixed(0)}% of income)`} style={{ width: `${(p.v / total) * 100}%`, background: p.color }} /> : null,
        )}
      </div>
      <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded opacity-60" title="Guideline: 50% needs / 30% wants / 20% savings">
        <div style={{ width: "50%", background: SERIES.needs }} />
        <div style={{ width: "30%", background: SERIES.wants }} />
        <div style={{ width: "20%", background: SERIES.savings }} />
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] @lg:grid-cols-4">
        {parts.map((p) => (
          <div key={p.k} className="flex items-center gap-1.5">
            <span className="inline-block size-2 rounded-sm" style={{ background: p.color }} />
            <span>{p.label}</span>
            <span className="num ml-auto">{money(p.v)}</span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground">
        Thin bar = the 50/30/20 guideline: needs {money(g.needs)} · wants {money(g.wants)} · savings {money(g.savings)}. Income is your 12-month average take-home ({money(cf.income)}/mo).
      </p>
    </div>
  );
}

const STEP_ICON = { done: CheckCircle2, active: CircleDot, waiting: Circle } as const;

function ProbabilityBar({ p }: { p: number | null }) {
  if (p === null) return <span className="text-muted-foreground">—</span>;
  const pct = Math.round(p * 100);
  return (
    <div className="flex items-center gap-1.5" title={`${pct}% of 5,000 simulated markets reach the target by the date`}>
      <div className="h-1.5 w-16 overflow-hidden rounded bg-muted">
        <div className="h-full" style={{ width: `${pct}%`, background: pct >= 80 ? "#199e70" : pct >= 50 ? "#c98500" : "#e5534b" }} />
      </div>
      <span className="num w-9 text-right">{pct}%</span>
    </div>
  );
}

function NetWorthChart({ plan, assumptions }: { plan: Plan; assumptions: Assumptions }) {
  const [nominal, setNominal] = useState(false);
  const year0 = new Date().getFullYear();
  const f = (v: number, y: number) => (nominal ? v * (1 + assumptions.inflationPct / 100) ** y : v);
  const data = plan.netWorth.sim.bands.map((b) => ({ year: year0 + b.year, band: [f(b.p10, b.year), f(b.p90, b.year)], p50: f(b.p50, b.year) }));
  return (
    <Card
      title={`Net worth projection (${plan.netWorth.years} years, ${plan.netWorth.sim.runs.toLocaleString()} simulations)`}
      right={
        <div className="flex gap-0.5 text-[11px]">
          {[false, true].map((n) => (
            <button key={String(n)} onClick={() => setNominal(n)} className={cn("rounded px-1.5 py-0.5", nominal === n ? "bg-secondary" : "text-muted-foreground")}>
              {n ? "nominal $" : "today's $"}
            </button>
          ))}
        </div>
      }
    >
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid stroke="#1f2125" vertical={false} />
            <XAxis dataKey="year" tick={{ fill: "#8b8d93", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "#2a2c31" }} minTickGap={30} />
            <YAxis tick={{ fill: "#8b8d93", fontSize: 10 }} tickLine={false} axisLine={false} width={64} tickFormatter={(v: number) => money(v, { compact: true, whole: true })} />
            <Tooltip
              contentStyle={{ background: "#1c1d21", border: "1px solid #2a2c31", borderRadius: 6, fontSize: 11 }}
              formatter={(v, n) => (Array.isArray(v) ? [`${money(Number(v[0]), { whole: true })} – ${money(Number(v[1]), { whole: true })}`, "p10–p90"] : [money(Number(v), { whole: true }), n === "p50" ? "median" : String(n)])}
            />
            <Area dataKey="band" stroke="none" fill="#3987e5" fillOpacity={0.18} isAnimationActive={false} />
            <Line dataKey="p50" stroke="#3987e5" strokeWidth={2} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        Shaded band: 10th–90th percentile outcomes; line: median. Assumes this month&apos;s savings ({money(Math.max(0, plan.cashFlow.available))}/mo) invested at{" "}
        {Math.round(plan.risk.equityLong * 100)}% stocks. {nominal ? `Nominal: inflated at ${assumptions.inflationPct}%/yr.` : "Real dollars (today's purchasing power)."}
      </p>
    </Card>
  );
}

export interface CheckIn {
  month: string;
  hasTransactions: boolean;
  income: number;
  spent: number;
  planned: number;
  saved: number;
  plannedSaving: number | null;
  byCategory: { category: string; actual: number; planned: number }[];
}

function CheckInCard() {
  const q = useQuery({ queryKey: ["checkin"], queryFn: () => api<CheckIn>("/api/finances/checkin") });
  return (
    <Card title={`Monthly check-in · ${q.data?.month ?? ""}`}>
      {q.isPending ? (
        <LoadingRows rows={3} className="p-0" />
      ) : q.isError ? (
        <ErrorState error={q.error} compact />
      ) : !q.data.hasTransactions ? (
        <p className="text-[11px] text-muted-foreground">Import this month&apos;s bank CSV under Transactions to compare actual spending with the plan.</p>
      ) : (
        <div className="space-y-2 text-xs">
          <div className="num grid grid-cols-3 gap-2">
            <div>
              <div className="text-[10px] text-muted-foreground uppercase">Spent</div>
              {money(q.data.spent)} <span className="text-muted-foreground">/ {money(q.data.planned)} plan</span>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase">Income in</div>
              {money(q.data.income)}
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase">Saved</div>
              <span className={q.data.plannedSaving !== null && q.data.saved < q.data.plannedSaving ? "text-down" : "text-up"}>{money(q.data.saved, { sign: true })}</span>
              {q.data.plannedSaving !== null && <span className="text-muted-foreground"> / {money(q.data.plannedSaving)} plan</span>}
            </div>
          </div>
          <table className="w-full text-[11px]">
            <tbody>
              {q.data.byCategory.slice(0, 8).map((c) => (
                <tr key={c.category} className="border-t border-border/50">
                  <td className="py-0.5">{c.category}</td>
                  <td className={cn("num text-right", c.planned && c.actual > c.planned ? "text-down" : "")}>{money(c.actual)}</td>
                  <td className="num text-right text-muted-foreground">{c.planned ? `of ${money(c.planned)}` : "unplanned"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function PlanOverview({ country }: { country: Country }) {
  const q = useQuery({ queryKey: ["plan"], queryFn: () => api<{ plan: Plan | null; assumptions: Assumptions }>("/api/finances/plan") });
  if (q.isPending) return <LoadingRows rows={10} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const plan = q.data.plan;
  if (!plan) return <EmptyState title="No plan yet" hint="Fill in My finances first." />;
  const a = q.data.assumptions;

  return (
    <div className="@container space-y-3">
      {plan.crossBorderWarning && (
        <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>{plan.crossBorderWarning}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 @3xl:grid-cols-4">
        <Tile label="Avg monthly income" value={money(plan.monthlyIncome)} sub="take-home, next 12 months" />
        <Tile label="Left to save / month" value={<span className={plan.cashFlow.available < 0 ? "text-down" : ""}>{money(plan.cashFlow.available)}</span>} sub={`${plan.cashFlow.savingsRatePct}% savings rate`} />
        <Tile label="Goals need / month" value={money(plan.feasibility.needed)} sub={plan.feasibility.shortfall > 0 ? <span className="text-down">short {money(plan.feasibility.shortfall)}/mo</span> : "covered"} />
        <Tile label="Net worth today" value={money(plan.netWorth.current)} sub={`median in ${plan.netWorth.years}y: ${money(plan.netWorth.sim.p50, { compact: true, whole: true })} (today's $)`} />
      </div>

      <div className={cn("rounded-md border p-3 text-xs", plan.feasibility.shortfall > 0 ? "border-down/40 bg-down-muted" : "border-up/40 bg-up-muted")}>
        <p>{plan.feasibility.message}</p>
        {plan.cuts.length > 0 && (
          <p className="mt-1 text-muted-foreground">
            Biggest easy cuts: {plan.cuts.map((c) => `${c.category} −${money(c.cut)}`).join(", ")} (frees {money(plan.cuts.reduce((s, c) => s + c.cut, 0))}/mo).
          </p>
        )}
      </div>

      <div className="grid gap-3 @4xl:grid-cols-2">
        <Card title="Where your money goes each month">
          <CashFlowBar plan={plan} />
        </Card>
        <Card title="Where each saved dollar goes (priority order)">
          <ol className="space-y-1.5 text-xs">
            {plan.waterfall.map((s, i) => {
              const Icon = STEP_ICON[s.status];
              return (
                <li key={s.key} className="flex items-start gap-2">
                  <Icon className={cn("mt-0.5 size-3.5 shrink-0", s.status === "done" ? "text-up" : s.status === "active" ? "text-series-1" : "text-muted-foreground")} />
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between gap-2">
                      <span>
                        {i + 1}. {s.label}
                      </span>
                      <span className="num">{s.status === "done" ? <Tag tone="up">done</Tag> : `${money(s.monthly)}/mo`}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">{s.note}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>
      </div>

      <Card title={`Goals · ${plan.goals.length}`}>
        {plan.goals.length === 0 ? (
          <p className="text-xs text-muted-foreground">No goals yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] tracking-wider text-muted-foreground uppercase">
                <tr className="text-left">
                  <th className="py-1 font-medium">Goal</th>
                  <th className="text-right font-medium">Target</th>
                  <th className="text-right font-medium">Need/mo</th>
                  <th className="text-right font-medium">Getting/mo</th>
                  <th className="pl-3 font-medium">Where</th>
                  <th className="font-medium">Mix (stocks/bonds/cash)</th>
                  <th className="font-medium">Chance on time</th>
                </tr>
              </thead>
              <tbody>
                {plan.goals.map((g) => (
                  <tr key={g.goal.id} className="border-t border-border/50 align-top">
                    <td className="py-1.5">
                      <div className="font-medium">{g.goal.name}</div>
                      <div className="text-[10px] text-muted-foreground">
                        by {g.goal.targetDate} · {g.yearsLeft}y · {money(g.goal.current)} saved
                      </div>
                    </td>
                    <td className="num text-right">{money(g.goal.target, { whole: true })}</td>
                    <td className="num text-right">{money(g.requiredMonthly)}</td>
                    <td className="num text-right">
                      <span className={g.onTrack ? "text-up" : "text-down"}>{money(g.allocatedMonthly)}</span>
                      {!g.onTrack && <div className="text-[10px] text-down">behind {money(g.requiredMonthly - g.allocatedMonthly)}/mo</div>}
                    </td>
                    <td className="max-w-48 pl-3" title={g.account.why}>
                      <Tag tone="info">{g.account.type.replace("_", " ")}</Tag>
                      <div className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">{g.account.why}</div>
                    </td>
                    <td className="num">
                      {Math.round(g.mix.equity * 100)}/{Math.round(g.mix.bonds * 100)}/{Math.round(g.mix.cash * 100)}
                      <div className="text-[10px] text-muted-foreground">
                        {g.band} horizon · {g.expectedRealReturnPct}% real/yr
                      </div>
                    </td>
                    <td>
                      <ProbabilityBar p={g.sim.probability} />
                      <div className="num text-[10px] text-muted-foreground">
                        median {money(g.sim.p50, { whole: true })}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-3 @4xl:grid-cols-2">
        {plan.debt ? (
          <Card title="Debt payoff">
            <table className="w-full text-xs">
              <tbody>
                {[plan.debt.avalanche, plan.debt.snowball].map((d) => (
                  <tr key={d.strategy} className="border-t border-border/50 first:border-0">
                    <td className="py-1 capitalize">{d.strategy}</td>
                    <td className="text-muted-foreground">{d.strategy === "avalanche" ? "highest rate first" : "smallest balance first"}</td>
                    <td className="num text-right">{d.months} months</td>
                    <td className="num text-right">{money(d.totalInterest)} interest</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {plan.debt.interestSavedVsSnowball > 0
                ? `Avalanche saves ${money(plan.debt.interestSavedVsSnowball)} of interest vs snowball.`
                : "Both methods pay in the same order here, so they cost the same."}{" "}
              Payoff order: {plan.debt.avalanche.order.join(" → ")}.
            </p>
          </Card>
        ) : (
          <Card title="Debt payoff">
            <p className="text-xs text-muted-foreground">No debts.</p>
          </Card>
        )}
        <CheckInCard />
      </div>

      <NetWorthChart plan={plan} assumptions={a} />

      <Card title="Example low-cost funds for your long-term money">
        <ul className="space-y-1 text-xs">
          {fundsForMix(country, { equity: plan.risk.equityLong, bonds: 1 - plan.risk.equityLong, cash: 0.01 }).map((f) => (
            <li key={f.ticker} className="flex flex-wrap items-baseline gap-2">
              <span className="w-12 font-mono font-semibold">{f.ticker}</span>
              <span className="text-muted-foreground">{f.name}</span>
              <span className="num ml-auto">
                {f.feePct !== null ? (
                  <span title={`Verified ${f.feeVerified} at ${f.feeSource}`}>
                    fee {f.feePct.toFixed(2)}% · costs {feeDrag(a.classes.equity.realReturnPct + a.inflationPct, f.feePct, 30)}% of the balance over 30y
                  </span>
                ) : (
                  <a href={f.issuerUrl} target="_blank" rel="noopener noreferrer" className="text-amber-300 hover:underline">
                    fee not verified: check issuer <ExternalLink className="inline size-3" />
                  </a>
                )}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          Examples, not recommendations. Fees compound: 1% a year costs about a quarter of a 30-year balance; broad index ETFs typically charge a small fraction of that.
        </p>
      </Card>
    </div>
  );
}
