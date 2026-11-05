"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import type { CategoryRow, SpendingAnalysis } from "@/lib/planner/spending";
import { cn } from "@/lib/utils";
import { Tag } from "../terminal/bits";

export interface PlanResponseExtras {
  spending: SpendingAnalysis;
  basis: "planned" | "actual";
  budgetBasisSetting: "planned" | "actual";
  alternate: { basis: "planned" | "actual"; available: number; shortfall: number; goals: { name: string; probability: number | null }[] } | null;
}

const TONE: Record<CategoryRow["status"], "down" | "up" | "muted" | "warn" | "info"> = {
  over: "down",
  under: "up",
  "on track": "info",
  "no data": "muted",
  unplanned: "warn",
};

export function useBudgetActions() {
  const qc = useQueryClient();
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["plan"] }), qc.invalidateQueries({ queryKey: ["profile"] })]);
  return {
    setBasis: (basis: "planned" | "actual") =>
      api("/api/finances/profile", { method: "PATCH", body: { budgetBasis: basis } })
        .then(refresh)
        .catch((e: Error) => toast.error(e.message)),
    mapCategory: (from: string, to: string | null) =>
      api("/api/finances/profile", { method: "PATCH", body: { mapCategory: { from, to } } })
        .then(refresh)
        .catch((e: Error) => toast.error(e.message)),
  };
}

/** "Plan with: my budget / my actual spending" toggle + the comparison line. */
export function BasisToggle({ x }: { x: PlanResponseExtras }) {
  const { setBasis } = useBudgetActions();
  const canActual = x.spending.completeMonths.length > 0;
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px]">
      <span className="text-muted-foreground">Plan with:</span>
      <div className="flex rounded-md border border-border p-0.5">
        {(["planned", "actual"] as const).map((b) => (
          <button
            key={b}
            disabled={b === "actual" && !canActual}
            title={b === "actual" && !canActual ? "Needs at least one complete month of imported transactions" : undefined}
            onClick={() => void setBasis(b)}
            className={cn("rounded px-2 py-0.5 disabled:opacity-40", x.basis === b ? "bg-secondary font-medium" : "text-muted-foreground hover:text-foreground")}
          >
            {b === "planned" ? "my budget" : "my actual spending"}
          </button>
        ))}
      </div>
      {x.alternate && (
        <span className="num text-muted-foreground">
          With {x.alternate.basis === "actual" ? "your actual spending" : "your budget"} instead: left to save {money(x.alternate.available)}/mo
          {x.alternate.shortfall > 0 ? `, goals short ${money(x.alternate.shortfall)}/mo` : ", goals covered"}.
        </span>
      )}
    </div>
  );
}

/** Compact card for My plan: totals, the biggest overs, and warnings. */
export function BudgetCheck({ x }: { x: PlanResponseExtras }) {
  const s = x.spending;
  const over = s.rows.filter((r) => r.status === "over" || (r.status === "unplanned" && (r.actualAvg ?? 0) > 0)).sort((a, b) => (b.diff ?? 0) - (a.diff ?? 0));
  return (
    <section className="min-w-0 rounded-md border border-border bg-background/40 p-3 text-xs">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Budget check: planned vs actual</h3>
        <BasisToggle x={x} />
      </div>
      {s.completeMonths.length === 0 && s.totals.monthToDate === 0 ? (
        <p className="text-[11px] text-muted-foreground">Import bank or card CSVs under Transactions, then see Analysis to compare what you actually spend with your budget.</p>
      ) : (
        <>
          <div className="num grid grid-cols-3 gap-2">
            <div>
              <div className="text-[10px] text-muted-foreground uppercase">Budget / month</div>
              {money(s.totals.planned)}
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase">
                Actual avg ({s.completeMonths.length} month{s.completeMonths.length === 1 ? "" : "s"})
              </div>
              {s.totals.actualAvg === null ? (
                "—"
              ) : (
                <span className={s.totals.actualAvg > s.totals.planned ? "text-down" : "text-up"}>
                  {money(s.totals.actualAvg)} ({s.totals.actualAvg > s.totals.planned ? "+" : "−"}
                  {money(Math.abs(s.totals.actualAvg - s.totals.planned))})
                </span>
              )}
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase">
                {s.currentMonth} so far (day {s.daysElapsed}/{s.daysInMonth})
              </div>
              {money(s.totals.monthToDate)}
            </div>
          </div>
          {over.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[11px]">
              {over.slice(0, 4).map((r) => (
                <li key={r.actualCategories.join(",") + r.planCategory}>
                  <Tag tone={TONE[r.status]}>{r.status}</Tag> {r.planCategory ?? r.actualCategories[0]}: {money(r.actualAvg)} vs {money(r.planned)} budget
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {s.warnings.map((w) => (
        <p key={w} className="mt-1 flex gap-1 text-[10px] text-amber-300">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          {w}
        </p>
      ))}
      <p className="mt-1 text-[10px] text-muted-foreground">Full breakdown and category matching under Analysis.</p>
    </section>
  );
}

/** Full table for the Analysis tab, with category matching for unbudgeted spending. */
export function SpendingTable({ x, budgetLines }: { x: PlanResponseExtras; budgetLines: string[] }) {
  const { mapCategory } = useBudgetActions();
  const s = x.spending;
  return (
    <section className="rounded-md border border-border bg-background/40 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold">Spending vs budget</h3>
        <BasisToggle x={x} />
      </div>
      <p className="mb-2 text-[10px] text-muted-foreground">
        Average over complete months ({s.completeMonths.join(", ") || "none yet"}). {s.currentMonth} is shown to date with a pace estimate for the full month. Income and
        transfers (like card payments) aren&apos;t spending.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="text-[10px] text-muted-foreground uppercase">
            <tr className="text-right">
              <th className="py-1 text-left font-medium">Budget line</th>
              <th className="text-left font-medium">From transactions</th>
              <th className="font-medium">Budget</th>
              <th className="font-medium">Actual avg</th>
              <th className="font-medium">Last month</th>
              <th className="font-medium">This month so far</th>
              <th className="font-medium">Pace</th>
              <th className="pl-2 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="num">
            {s.rows.filter((r) => !(r.status === "unplanned" && !r.actualAvg && !r.monthToDate && !r.lastMonth)).map((r) => (
              <tr key={(r.planCategory ?? "") + r.actualCategories.join(",")} className="border-t border-border/50 text-right">
                <td className="py-1 text-left font-sans">
                  {r.planCategory ?? (
                    <select
                      aria-label={`Count ${r.actualCategories[0]} as`}
                      className="h-6 rounded border border-input bg-background px-1 text-[11px]"
                      value=""
                      onChange={(e) => void mapCategory(r.actualCategories[0]!, e.target.value)}
                    >
                      <option value="">count as… (unbudgeted)</option>
                      {budgetLines.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="text-left font-sans text-muted-foreground">
                  {r.actualCategories.join(", ") || "—"}
                  {r.manualCategories.length > 0 && (
                    <button className="ml-1 text-[10px] text-series-1 hover:underline" title="Undo your manual mapping" onClick={() => r.manualCategories.forEach((c) => void mapCategory(c, null))}>
                      undo mapping
                    </button>
                  )}
                </td>
                <td>{r.planCategory ? money(r.planned) : "—"}</td>
                <td className={cn(r.status === "over" && "text-down", r.status === "under" && "text-up")}>{r.actualAvg === null ? "—" : money(r.actualAvg)}</td>
                <td>{r.lastMonth === null ? "—" : money(r.lastMonth)}</td>
                <td>{money(r.monthToDate)}</td>
                <td>{r.pace === null ? "—" : money(r.pace)}</td>
                <td className="pl-2 text-left">
                  <Tag tone={TONE[r.status]}>{r.status}</Tag>
                </td>
              </tr>
            ))}
            <tr className="border-t border-border text-right font-medium">
              <td className="py-1 text-left font-sans">Total</td>
              <td />
              <td>{money(s.totals.planned)}</td>
              <td>{s.totals.actualAvg === null ? "—" : money(s.totals.actualAvg)}</td>
              <td />
              <td>{money(s.totals.monthToDate)}</td>
              <td>{s.totals.pace === null ? "—" : money(s.totals.pace)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      {s.warnings.map((w) => (
        <p key={w} className="mt-1 flex gap-1 text-[10px] text-amber-300">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          {w}
        </p>
      ))}
    </section>
  );
}
