"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Info } from "lucide-react";
import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import type { YearSummary } from "@/lib/planner/summary";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorState, LoadingRows, Tag } from "../terminal/bits";
import { SpendingTable, type PlanResponseExtras } from "./budget-check";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const C = { income: "#199e70", spent: "#d95926", budget: "#8b8d93", grid: "#1f2125", axis: "#2a2c31", tick: "#8b8d93" };

function Card({ title, children, right, className }: { title: string; children: React.ReactNode; right?: React.ReactNode; className?: string }) {
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

function Tile({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "up" | "down" }) {
  return (
    <div className="rounded-md border border-border bg-background/40 px-3 py-2">
      <div className="text-[10px] tracking-wider text-muted-foreground uppercase">{label}</div>
      <div className={cn("num mt-0.5 text-lg leading-tight", tone === "up" && "text-up", tone === "down" && "text-down")}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

const monthName = (m: string | null | undefined) => (m ? `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}` : "");

export function Analysis() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const q = useQuery({ queryKey: ["summary", year], queryFn: () => api<{ summary: YearSummary | null }>(`/api/finances/summary?year=${year}`) });
  const plan = useQuery({
    queryKey: ["plan"],
    queryFn: () => api<{ plan: unknown } & Partial<PlanResponseExtras>>("/api/finances/plan"),
    select: (d) => ({ ...d, budgetLines: (d.spending?.rows ?? []).flatMap((r) => (r.planCategory ? [r.planCategory] : [])) }),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">Analysis</h2>
        <div className="ml-auto flex items-center gap-1" role="group" aria-label="Year">
          {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
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
      {plan.data?.spending && plan.data.plan !== null && (
        <SpendingTable x={plan.data as PlanResponseExtras} budgetLines={plan.data.budgetLines} />
      )}
    </div>
  );
}

function YearView({ s }: { s: YearSummary }) {
  const n = s.spending.monthsWithData.length;
  const range = n ? `${monthName(s.spending.monthsWithData[0])}–${monthName(s.spending.monthsWithData.at(-1))}` : "";
  const overBudget = s.spending.actual - s.spending.budgetSameMonths;
  const data = s.months.map((m) => ({ label: MONTHS[Number(m.month.slice(5, 7)) - 1], takeHome: m.takeHome, spent: m.spent, budget: m.budget }));

  return (
    <>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Tile
          label={`Take-home ${s.year}`}
          value={money(s.income.takeHomeYear, { whole: true })}
          sub={s.income.throughMonth && s.income.throughMonth < `${s.year}-12` ? <>{money(s.income.takeHomeToDate, { whole: true })} of it through {monthName(s.income.throughMonth)}</> : "from your income lines"}
        />
        <Tile
          label="Spent"
          value={n ? money(s.spending.actual, { whole: true }) : "—"}
          sub={n ? <>{range} · {money(s.spending.actual / n, { whole: true })}/mo</> : "import transactions to see this"}
        />
        <Tile
          label="vs budget, same months"
          value={n ? `${overBudget > 0 ? "+" : ""}${money(overBudget, { whole: true })}` : "—"}
          tone={n ? (overBudget > 0 ? "down" : "up") : undefined}
          sub={
            n ? (
              <>
                budget {money(s.spending.budgetSameMonths, { whole: true })} for {n} month{n === 1 ? "" : "s"}
                {s.spending.noDataLines.length > 0 && <>, incl. {s.spending.noDataLines.join(", ")} with no transactions yet</>}
              </>
            ) : undefined
          }
        />
        <Tile
          label="Kept (take-home − spent)"
          value={s.savedOverDataMonths === null ? "—" : money(s.savedOverDataMonths, { whole: true })}
          tone={s.savedOverDataMonths === null ? undefined : s.savedOverDataMonths >= 0 ? "up" : "down"}
          sub={n ? `over ${range}` : undefined}
        />
      </div>

      <Card title={`Month by month, ${s.year}`}>
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 8 }} barGap={2}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: C.tick, fontSize: 10 }} tickLine={false} axisLine={{ stroke: C.axis }} />
              <YAxis tick={{ fill: C.tick, fontSize: 10 }} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => money(v, { compact: true, whole: true })} />
              <Tooltip
                cursor={{ fill: "rgba(255,255,255,0.04)" }}
                contentStyle={{ background: "#1c1d21", border: "1px solid #2a2c31", borderRadius: 6, fontSize: 11 }}
                formatter={(v, name) => [v === null || v === undefined ? "no data" : money(Number(v)), String(name)]}
              />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="takeHome" name="Take-home" fill={C.income} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="spent" name="Spent (transactions)" fill={C.spent} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Line dataKey="budget" name="Budget" stroke={C.budget} strokeDasharray="4 3" dot={false} strokeWidth={1.5} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Take-home comes from your income lines (past jobs included); spent comes from imported transactions (card payments and transfers don&apos;t count). The dashed line is
          your budget for each month, so a lease change or a cheaper summer shows up as a step.
          {s.income.fromTransactions > 0 && <> Deposits seen in your transactions this year: {money(s.income.fromTransactions, { whole: true })}.</>}
        </p>
      </Card>

      {s.attention.length > 0 && (
        <Card title="Needs attention">
          <ul className="space-y-1.5">
            {s.attention.map((a, k) => (
              <li key={k} className="flex gap-2 text-xs">
                {a.severity === "info" ? <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /> : <AlertTriangle className={cn("mt-0.5 size-3.5 shrink-0", a.severity === "high" ? "text-down" : "text-amber-300")} />}
                <span>{a.text}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={n ? `Where the money went (${range})` : "Where the money went"}>
        {s.categories.length === 0 ? (
          <EmptyState title="No spending yet" hint="Import a bank or credit-card CSV under Transactions." />
        ) : (
          <div className="space-y-2.5">
            {s.categories.map((c) => {
              const over = c.budgeted && c.diff > Math.max(10, c.budget * 0.1);
              return (
                <div key={c.label}>
                  <div className="flex items-baseline gap-2 text-xs">
                    <span className="font-medium">{c.label}</span>
                    {!c.budgeted && <Tag tone="warn">no budget line</Tag>}
                    {over && <Tag tone="down">over</Tag>}
                    <span className="num ml-auto">{money(c.actual)}</span>
                    <span className="num w-24 text-right text-[11px] text-muted-foreground">{c.budgeted ? `of ${money(c.budget, { whole: true })}` : ""}</span>
                    <span className="num w-10 text-right text-[11px] text-muted-foreground">{c.sharePct.toFixed(0)}%</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, c.sharePct)}%`, background: over || !c.budgeted ? C.spent : "#3987e5" }} />
                  </div>
                  {c.top.length > 0 && (
                    <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                      Biggest: {c.top.map((t) => `${t.description} ${money(t.amount)} (${t.date.slice(5)})`).join(" · ")}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}
