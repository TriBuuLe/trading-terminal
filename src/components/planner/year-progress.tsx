"use client";

import { useQuery } from "@tanstack/react-query";
import { Fragment } from "react";
import { CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import type { LongTermGoal, Progress, YearPlan } from "@/lib/planner/yearplan";
import { cn } from "@/lib/utils";
import { ErrorState, LoadingRows, Tag } from "../terminal/bits";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const C = { actual: "#199e70", planned: "#3987e5", grid: "#1f2125", axis: "#2a2c31", tick: "#8b8d93", goal: "#c98500" };
const w = (x: number | null | undefined) => (x === null || x === undefined ? "—" : money(x, { whole: true }));
const mName = (m: string) => MONTHS[Number(m.slice(5, 7)) - 1]!;
const span = (ms: string[]) => (ms.length ? (ms.length === 1 ? mName(ms[0]!) : `${mName(ms[0]!)}–${mName(ms.at(-1)!)}`) : "");

interface YearResponse {
  year: number;
  plan: YearPlan | null;
  progress: Progress | null;
  longTerm: LongTermGoal[];
  netWorth: number;
  income: { ahead: number; coveredThrough: string | null } | null;
  balance: {
    anchor: { date: string; balance: number } | null;
    monthEnd: (number | null)[];
    today: { date: string; cash: number; source: "entered" | "statements" } | null;
    projected: { date: string; cash: number; incomeAfterToday: number; budgetRest: number } | null;
  } | null;
}

function Card({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-md border border-border bg-background/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "up" | "down" }) {
  return (
    <div className="rounded-md border border-border bg-background/40 px-3 py-2">
      <div className="text-[10px] tracking-wider text-muted-foreground uppercase">{label}</div>
      <div className={cn("num mt-0.5 text-lg leading-tight", tone === "up" && "text-up", tone === "down" && "text-down")}>{value}</div>
      {sub && <div className="num mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

const STATUS_TONE = { met: "up", missed: "down", "no budget": "muted", "no statement": "warn", "in progress": "info", upcoming: "muted" } as const;

/** The calendar-year plan vs statements: December goals, progress, what's needed for the rest of the year. */
export function YearProgress() {
  const q = useQuery({ queryKey: ["year"], queryFn: () => api<YearResponse | null>("/api/finances/year") });
  if (q.isPending) return <LoadingRows rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const r = q.data;
  if (!r?.progress) return null;
  const p = r.progress;
  const doneSpan = span(p.toDate.months);
  const so = p.toDate.saved + p.toDate.invested;
  const rem = p.remaining;
  const spendAhead = p.months.filter((m) => rem.months.includes(m.month)).reduce((t, m) => t + m.planned.spending, 0);
  return (
    <>
      <div className="grid grid-cols-2 gap-2 @3xl:grid-cols-4">
        <Tile label={`${r.year} goal: save + invest`} value={p.goals.total > 0 ? w(p.goals.total) : "not set"} sub={p.goals.total > 0 ? `save ${w(p.goals.save)} · invest ${w(p.goals.invest)} (My finances)` : "set Save / Invest in My finances"} />
        <Tile
          label={doneSpan ? `Kept so far (${doneSpan})` : "Kept so far"}
          value={w(so)}
          tone={p.toDate.months.length ? (so >= 0 ? "up" : "down") : undefined}
          sub={p.toDate.months.length ? `money in − spending · cash ${w(p.toDate.saved)} + invested ${w(p.toDate.invested)}` : "no complete statement yet"}
        />
        <Tile
          label="Projected Dec 31"
          value={w(rem.projected)}
          tone={p.goals.total > 0 ? (rem.shortfall > 0 ? "down" : "up") : undefined}
          sub={
            <>
              {w(so)} + {w(r.income?.ahead ?? 0)} still expected − {w(spendAhead)} budget {span(rem.months)}
              {p.goals.total <= 0 ? null : rem.shortfall > 0 ? <span className="text-down"> · {w(rem.shortfall)} short of goal</span> : <span className="text-up"> · goal reached</span>}
            </>
          }
        />
        <Tile
          label={rem.months.length ? `To reach the goal (${span(rem.months)})` : "To reach the goal"}
          value={p.goals.total <= 0 ? "—" : rem.shortfall > 0 ? `−${w(rem.cutSpendingPerMonth)}/mo` : "on track"}
          tone={p.goals.total <= 0 ? undefined : rem.shortfall > 0 ? "down" : "up"}
          sub={p.goals.total <= 0 ? "no goal set" : rem.shortfall > 0 ? `spend this much less than your budget each month, or lower the goal` : `keep spending within your budget`}
        />
      </div>
      {r.balance && <BalanceChart b={r.balance} year={r.year} />}
      <MonthTable p={p} />
    </>
  );
}

/** Checking balance: month ends from your statements (solid), today's balance, and Dec 31 projected (dashed). */
function BalanceChart({ b, year }: { b: NonNullable<YearResponse["balance"]>; year: number }) {
  const t = b.today;
  const todayIdx = t ? Number(t.date.slice(5, 7)) - 1 : -1;
  const data = MONTHS.map((label, k) => ({
    label,
    statements: b.monthEnd[k] ?? null,
    today: t && t.source === "entered" && k === todayIdx ? t.cash : null,
    projected: b.projected && t ? (k === todayIdx ? t.cash : k === 11 && todayIdx < 11 ? b.projected.cash : null) : null,
  }));
  return (
    <Card title={`Checking balance, ${year}`}>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: C.tick, fontSize: 10 }} tickLine={false} axisLine={{ stroke: C.axis }} />
            <YAxis tick={{ fill: C.tick, fontSize: 10 }} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => money(v, { compact: true, whole: true })} />
            <Tooltip contentStyle={{ background: "#1c1d21", border: "1px solid #2a2c31", borderRadius: 6, fontSize: 11 }} formatter={(v, name) => [v === null || v === undefined ? "—" : money(Number(v)), String(name)]} />
            <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
            <Line dataKey="statements" name="End of month (statements)" stroke={C.actual} strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
            {b.projected && <Line dataKey="projected" name="Projected" stroke={C.planned} strokeDasharray="4 3" strokeWidth={2} dot={{ r: 2.5 }} connectNulls isAnimationActive={false} />}
            {t?.source === "entered" && <Line dataKey="today" name="Today (you entered)" stroke={C.goal} strokeWidth={0} dot={{ r: 4, fill: C.goal }} isAnimationActive={false} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="num mt-1 text-[11px] text-muted-foreground">
        {b.anchor ? <>From your Bank of America statements: the bank&apos;s balance {w(b.anchor.balance)} on {b.anchor.date}, worked back through each checking transaction. </> : <>Import a Bank of America CSV to draw your balance. </>}
        {t && b.projected ? (
          <>
            Dec 31: {w(t.cash)} {t.source === "entered" ? "today (you entered)" : `on ${t.date} (last statement)`} + {w(b.projected.incomeAfterToday)} paychecks after that − {w(b.projected.budgetRest)} budget = <b className="text-foreground">{w(b.projected.cash)}</b>.
          </>
        ) : (
          <>Add income lines and a budget in My finances to project Dec 31.</>
        )}{" "}
        Card purchases count once you pay the card.
      </p>
    </Card>
  );
}

/** Plan vs statement per month: income, spending, cash saved, invested, and whether the month met the plan. */
function MonthTable({ p }: { p: Progress }) {
  const rows: { label: string; plan: (m: Progress["months"][number]) => number; actual: (a: NonNullable<Progress["months"][number]["actual"]>) => number; good: "higher" | "lower" }[] = [
    { label: "Income", plan: (m) => m.planned.income, actual: (a) => a.income, good: "higher" },
    { label: "Spending", plan: (m) => m.planned.spending, actual: (a) => a.spending, good: "lower" },
    { label: "Cash saved", plan: (m) => m.planned.save, actual: (a) => a.saved, good: "higher" },
    { label: "Invested", plan: (m) => m.planned.invest, actual: (a) => a.invested, good: "higher" },
  ];
  return (
    <Card title={`Plan vs statements, ${p.year}`}>
      <div className="overflow-x-auto">
        <table className="num w-full text-[11px]">
          <thead className="text-[10px] tracking-wider text-muted-foreground uppercase">
            <tr>
              <th className="py-1 text-left font-medium" />
              {p.months.map((m) => (
                <th key={m.month} className="px-1 text-right font-medium">
                  {mName(m.month)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.label}>
                <tr className="border-t border-border/50 text-muted-foreground">
                  <td className="py-0.5 pr-2 font-sans whitespace-nowrap">{r.label} · plan</td>
                  {p.months.map((m) => (
                    <td key={m.month} className="px-1 text-right">
                      {w(r.plan(m))}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-0.5 pr-2 font-sans whitespace-nowrap">{r.label} · actual</td>
                  {p.months.map((m) => {
                    if (!m.actual) return <td key={m.month} className="px-1 text-right text-muted-foreground">—</td>;
                    const a = r.actual(m.actual);
                    const plan = r.plan(m);
                    const ok = r.good === "higher" ? a >= plan : a <= plan;
                    return (
                      <td key={m.month} className={cn("px-1 text-right", ok ? "text-up" : "text-down")}>
                        {w(a)}
                      </td>
                    );
                  })}
                </tr>
              </Fragment>
            ))}
            <tr className="border-t border-border">
              <td className="py-1 pr-2 font-sans" title="Spending stayed within your budget that month">Within budget</td>
              {p.months.map((m) => (
                <td key={m.month} className="px-1 text-right">
                  <Tag tone={STATUS_TONE[m.status]} className="px-0.5 text-[9px]">
                    {m.status === "met" ? "yes" : m.status === "missed" ? "no" : m.status === "no statement" ? "no stmt" : m.status === "in progress" ? "now" : "–"}
                  </Tag>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Long-term goals (kept across years): current, target, projected at the current pace, gap, pace needed. */
export function LongTermGoals() {
  const q = useQuery({ queryKey: ["year"], queryFn: () => api<YearResponse | null>("/api/finances/year") });
  const goals = q.data?.longTerm ?? [];
  if (!goals.length) return null;
  return (
    <Card title="Long-term goals">
      <div className="overflow-x-auto">
        <table className="num w-full text-xs">
          <thead className="text-[10px] tracking-wider text-muted-foreground uppercase">
            <tr className="text-right">
              <th className="py-1 text-left font-medium">Goal</th>
              <th className="font-medium">By</th>
              <th className="font-medium">Now</th>
              <th className="font-medium">Target</th>
              <th className="font-medium">Projected</th>
              <th className="font-medium">Gap</th>
              <th className="font-medium">Pace /mo</th>
              <th className="font-medium">Needed /mo</th>
            </tr>
          </thead>
          <tbody>
            {goals.map((g) => (
              <tr key={g.goal.id} className="border-t border-border/50 text-right">
                <td className="py-1 text-left font-sans">
                  {g.goal.name}
                  {g.goal.kind === "net_worth" && <span className="ml-1 text-[10px] text-muted-foreground">net worth</span>}
                </td>
                <td className="text-muted-foreground">{g.by}</td>
                <td>{w(g.current)}</td>
                <td>{w(g.target)}</td>
                <td className={g.gap > 0 ? "text-down" : "text-up"}>{w(g.projected)}</td>
                <td className={g.gap > 0 ? "text-down" : "text-muted-foreground"}>{g.gap > 0 ? w(g.gap) : "—"}</td>
                <td className="text-muted-foreground">{w(g.pacePerMonth)}</td>
                <td className={g.neededPerMonth > g.pacePerMonth ? "text-down" : ""}>{w(g.neededPerMonth)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">Projected = now + pace × months left, no investment growth. Net-worth pace = this year&apos;s save + invest plan ÷ 12.</p>
    </Card>
  );
}
