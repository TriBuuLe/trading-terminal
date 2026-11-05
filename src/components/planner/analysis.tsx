"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Info } from "lucide-react";
import { Fragment, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import type { CategoryRow, IncomeSource, YearSummary } from "@/lib/planner/summary";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorState, LoadingRows, Tag } from "../terminal/bits";
import { BasisToggle, type PlanResponseExtras } from "./budget-check";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const C = { income: "#199e70", spent: "#d95926", planned: "#8b8d93", grid: "#1f2125", axis: "#2a2c31", tick: "#8b8d93", bar: "#3987e5" };
const whole = (x: number | null | undefined) => (x === null || x === undefined ? "—" : money(x, { whole: true }));
const monthName = (m: string | null | undefined) => (m ? `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}` : "");

function Card({ title, children, right, className }: { title: string; children: React.ReactNode; right?: React.ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 rounded-md border border-border bg-background/40 p-3", className)}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
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
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function Analysis() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const q = useQuery({ queryKey: ["summary", year], queryFn: () => api<{ summary: YearSummary | null }>(`/api/finances/summary?year=${year}`) });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">Analysis</h2>
        <span className="text-[11px] text-muted-foreground">From your imported transactions. Your income and budget lines are shown next to them for comparison.</span>
        <div className="ml-auto flex items-center gap-1" role="group" aria-label="Year">
          {[thisYear - 1, thisYear].map((y) => (
            <button
              key={y}
              onClick={() => setYear(y)}
              className={cn("rounded px-2 py-0.5 text-xs", y === year ? "bg-secondary font-medium" : "text-muted-foreground hover:bg-accent")}
              aria-pressed={y === year}
            >
              {y}
            </button>
          ))}
        </div>
      </div>
      {q.isPending ? <LoadingRows rows={8} /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data.summary && <YearView s={q.data.summary} />}
    </div>
  );
}

function YearView({ s }: { s: YearSummary }) {
  const n = s.fullMonths.length;
  if (!s.months.some((m) => m.count > 0))
    return <EmptyState title={`No transactions in ${s.year}`} hint="Import your bank and credit-card CSVs under Transactions to see what really came in and went out." />;
  const range = n ? `${monthName(s.fullMonths[0])}–${monthName(s.fullMonths.at(-1))}` : "";
  const full = s.months.filter((m) => m.status === "full");
  const avgIncome = n ? full.reduce((t, m) => t + m.income!, 0) / n : null;
  const avgSaved = avgIncome !== null && s.spending.avgPerMonth !== null ? avgIncome - s.spending.avgPerMonth : null;
  const gap = s.income.actual - s.income.plannedSameMonths;

  return (
    <>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Tile
          label={`Money in, ${s.year}`}
          value={whole(s.income.actual)}
          sub={
            <>
              {whole(s.income.paychecks)} of it paychecks. Your income lines expected {whole(s.income.plannedSameMonths)} for these months ({gap >= 0 ? "+" : "−"}
              {whole(Math.abs(gap))}).
            </>
          }
        />
        <Tile label={`Spent, ${s.year}`} value={whole(s.spending.actual)} sub={n ? <>avg {whole(s.spending.avgPerMonth)}/month · budget {whole(s.spending.budgetPerMonth)}/month</> : "no full month yet"} />
        <Tile
          label="Saved (in − spent)"
          value={whole(s.saved.actual)}
          tone={s.saved.actual >= 0 ? "up" : "down"}
          sub={s.saved.ratePct !== null ? <>{s.saved.ratePct.toFixed(0)}% of what came in</> : undefined}
        />
        <Tile
          label="Typical month"
          value={avgSaved === null ? "—" : `${avgSaved >= 0 ? "+" : "−"}${whole(Math.abs(avgSaved))}`}
          tone={avgSaved === null ? undefined : avgSaved >= 0 ? "up" : "down"}
          sub={n ? <>{whole(avgIncome)} in − {whole(s.spending.avgPerMonth)} out, avg of {n} full month{n === 1 ? "" : "s"} ({range})</> : undefined}
        />
      </div>

      <MonthChart s={s} />

      <div className="grid gap-3 lg:grid-cols-2">
        <IncomeSources sources={s.income.sources} total={s.income.actual} />
        <Card title="Needs attention">
          {s.attention.length === 0 && s.dataChecks.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">Nothing stands out.</p>
          ) : (
            <ul className="space-y-1.5">
              {s.attention.map((a, k) => (
                <li key={k} className="flex gap-2 text-xs">
                  {a.severity === "info" ? <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /> : <AlertTriangle className={cn("mt-0.5 size-3.5 shrink-0", a.severity === "high" ? "text-down" : "text-amber-300")} />}
                  <span>{a.text}</span>
                </li>
              ))}
              {s.dataChecks.length > 0 && <li className="pt-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Is the data complete?</li>}
              {s.dataChecks.map((d, k) => (
                <li key={`d${k}`} className="flex gap-2 text-[11px] text-muted-foreground">
                  <Info className="mt-0.5 size-3.5 shrink-0" />
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <CategoryTable s={s} />
      <PlanBasis />
    </>
  );
}

function MonthChart({ s }: { s: YearSummary }) {
  const data = s.months.map((m) => ({
    label: `${MONTHS[Number(m.month.slice(5, 7)) - 1]}${m.status === "thin" ? "*" : m.status === "current" ? "…" : ""}`,
    income: m.income,
    spent: m.spent,
    planned: m.planned,
    saved: m.saved,
    status: m.status,
    count: m.count,
  }));
  const flagged = s.months.some((m) => m.status === "thin");
  return (
    <Card title={`Money in vs spent, month by month (${s.year})`}>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 8 }} barGap={2}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: C.tick, fontSize: 10 }} tickLine={false} axisLine={{ stroke: C.axis }} />
            <YAxis tick={{ fill: C.tick, fontSize: 10 }} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => money(v, { compact: true, whole: true })} />
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
              contentStyle={{ background: "#1c1d21", border: "1px solid #2a2c31", borderRadius: 6, fontSize: 11 }}
              formatter={(v, name) => [v === null || v === undefined ? "no data" : money(Number(v)), String(name)]}
              labelFormatter={(label, payload) => {
                const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
                if (!p) return String(label);
                const note = p.status === "thin" ? " · statement probably missing" : p.status === "current" ? " · month in progress" : "";
                return `${String(label).replace(/[*…]$/, "")}: ${p.count} transactions${p.saved !== null ? ` · saved ${money(p.saved)}` : ""}${note}`;
              }}
            />
            <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
            <Bar dataKey="income" name="Money in (transactions)" fill={C.income} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="spent" name="Spent (transactions)" fill={C.spent} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            <Line dataKey="planned" name="Take-home from your income lines" stroke={C.planned} strokeDasharray="4 3" dot={false} strokeWidth={1.5} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Green is every deposit marked Income; orange is everything you spent (card payments are left out, since the card&apos;s own purchases are counted). The dashed line is what your
        income lines in My finances expect.{flagged && <> * = very few transactions that month, so a statement is probably missing.</>} … = this month, still running.
      </p>
    </Card>
  );
}

function IncomeSources({ sources, total }: { sources: IncomeSource[]; total: number }) {
  return (
    <Card title="Where the money came from">
      {sources.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No transactions marked Income this year. Import your checking account (where your pay lands).</p>
      ) : (
        <table className="num w-full text-xs">
          <tbody>
            {sources.map((x) => (
              <tr key={x.label} className="border-t border-border/50 first:border-0">
                <td className="py-1 font-sans">
                  {x.label} <Tag className="ml-1">{x.kind}</Tag>
                </td>
                <td className="text-right text-[11px] text-muted-foreground">{x.count}×</td>
                <td className="w-28 text-right">{money(x.total)}</td>
                <td className="w-24 pl-2">
                  <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                    <div className="h-full rounded-full" style={{ width: `${total > 0 ? Math.min(100, (x.total / total) * 100) : 0}%`, background: C.income }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-2 text-[10px] text-muted-foreground">
        Money from friends (Zelle) is often them paying you back, and refunds give back money you&apos;d already spent: the paychecks are your real earnings.
      </p>
    </Card>
  );
}

const TONE: Record<CategoryRow["status"], "down" | "up" | "info" | "warn" | "muted"> = { over: "down", under: "up", "on track": "info", "no budget": "warn", "no transactions": "muted" };

function CategoryTable({ s }: { s: YearSummary }) {
  const [open, setOpen] = useState<string | null>(null);
  const last = s.fullMonths.at(-1);
  const n = s.fullMonths.length;
  return (
    <Card title={`Spending by category (${s.year})`}>
      <p className="mb-2 text-[11px] text-muted-foreground">
        Every category is its own row. <b>Avg/month</b> is over the {n} full month{n === 1 ? "" : "s"} you have data for; <b>Budget/month</b> is your budget line for those same months
        (lines with dates are averaged). Click a row for its biggest purchases.
      </p>
      <div className="overflow-x-auto">
        <table className="num w-full text-xs">
          <thead className="text-[10px] tracking-wider text-muted-foreground uppercase">
            <tr className="text-right">
              <th className="py-1 text-left font-medium">Category</th>
              <th className="font-medium">This year</th>
              <th className="font-medium">Avg/month</th>
              <th className="font-medium">Budget/month</th>
              <th className="font-medium">Difference</th>
              <th className="font-medium">{last ? MONTHS[Number(last.slice(5, 7)) - 1] : "Last month"}</th>
              <th className="w-28 pl-3 text-left font-medium">Share</th>
              <th className="pl-2 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {s.categories.map((c) => (
              <Fragment key={c.category}>
                <tr className="cursor-pointer border-t border-border/50 text-right hover:bg-accent/30" onClick={() => setOpen(open === c.category ? null : c.category)}>
                  <td className="py-1 text-left font-sans">{c.category}</td>
                  <td>{c.status === "no transactions" ? "—" : money(c.total)}</td>
                  <td>{c.status === "no transactions" ? "—" : whole(c.avgPerMonth)}</td>
                  <td className="text-muted-foreground">{whole(c.budgetPerMonth)}</td>
                  <td className={cn(c.status === "over" && "text-down", c.status === "under" && "text-up")}>
                    {c.diffPerMonth === null || c.status === "no transactions" ? "—" : Math.round(c.diffPerMonth) === 0 ? "$0" : `${c.diffPerMonth > 0 ? "+" : "−"}${whole(Math.abs(c.diffPerMonth))}`}
                  </td>
                  <td className="text-muted-foreground">{whole(c.lastMonth)}</td>
                  <td className="pl-3 text-left">
                    <div className="flex items-center gap-1.5">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-secondary">
                        <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, c.sharePct))}%`, background: c.status === "over" || c.status === "no budget" ? C.spent : C.bar }} />
                      </div>
                      <span className="text-[10px] text-muted-foreground">{c.sharePct.toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className="pl-2 text-left">
                    <Tag tone={TONE[c.status]}>{c.status}</Tag>
                  </td>
                </tr>
                {open === c.category && c.top.length > 0 && (
                  <tr>
                    <td colSpan={8} className="pb-2 pl-3 text-left text-[11px] text-muted-foreground">
                      Biggest: {c.top.map((t) => `${t.description.slice(0, 40)} ${money(t.amount)} (${t.date})`).join(" · ")}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            <tr className="border-t border-border text-right font-medium">
              <td className="py-1 text-left font-sans">Total</td>
              <td>{money(s.spending.actual)}</td>
              <td>{whole(s.spending.avgPerMonth)}</td>
              <td className="text-muted-foreground">{whole(s.spending.budgetPerMonth)}</td>
              <td colSpan={4} />
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">
        <b>over / under</b> = your monthly average is more than 10% above / below the budget line. <b>no budget</b> = you spend on it but have no budget line (add one in My finances).{" "}
        <b>no transactions</b> = budgeted, but nothing imported (paid from an account you haven&apos;t imported?).
      </p>
    </Card>
  );
}

/** Which spending the plan (My plan tab) uses. */
function PlanBasis() {
  const plan = useQuery({ queryKey: ["plan"], queryFn: () => api<{ plan: unknown } & Partial<PlanResponseExtras>>("/api/finances/plan") });
  if (!plan.data?.spending || plan.data.plan === null) return null;
  return (
    <Card title="Use this in your plan">
      <p className="mb-2 text-[11px] text-muted-foreground">Your plan (savings, goals, odds) can use your budget lines, or your actual average spending from these transactions.</p>
      <BasisToggle x={plan.data as PlanResponseExtras} />
    </Card>
  );
}
