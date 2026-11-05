"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Assumptions } from "@/lib/planner/types";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingRows } from "../terminal/bits";

function Editor({ initial, defaults }: { initial: Assumptions; defaults: Assumptions }) {
  const qc = useQueryClient();
  const [a, setA] = useState(initial);
  const done = async () => {
    await qc.invalidateQueries({ queryKey: ["plan"] });
    await qc.invalidateQueries({ queryKey: ["assumptions"] });
  };
  const save = useMutation({ mutationFn: () => api("/api/finances/assumptions", { method: "PUT", body: a }), onSuccess: async () => (toast.success("Assumptions saved"), done()), onError: (e) => toast.error(e.message) });
  const reset = useMutation({ mutationFn: () => api("/api/finances/assumptions", { method: "DELETE" }), onSuccess: async () => (setA(defaults), toast.success("Reset to defaults"), done()) });
  const n = "h-7 w-20 rounded-md border border-input bg-background px-2 text-right text-xs num";
  return (
    <section className="rounded-md border border-border bg-background/40 p-3 text-xs">
      <h3 className="font-semibold">Projection assumptions (real = after inflation)</h3>
      <p className="mt-0.5 text-[11px] text-muted-foreground">Used by every projection and probability. Defaults are deliberately below long-run history.</p>
      <table className="mt-2 w-full">
        <thead className="text-[10px] tracking-wider text-muted-foreground uppercase">
          <tr className="text-left">
            <th className="py-1 font-medium">Asset class</th>
            <th className="font-medium">Real return %/yr</th>
            <th className="font-medium">Volatility %</th>
            <th className="font-medium">Source</th>
          </tr>
        </thead>
        <tbody>
          {(["equity", "bonds", "cash"] as const).map((k) => (
            <tr key={k} className="border-t border-border/50 align-top">
              <td className="py-1.5">{a.classes[k].label}</td>
              <td>
                <input aria-label={`${k} return`} type="number" step={0.1} className={n} value={a.classes[k].realReturnPct} onChange={(e) => setA((x) => ({ ...x, classes: { ...x.classes, [k]: { ...x.classes[k], realReturnPct: Number(e.target.value) } } }))} />
              </td>
              <td>
                <input aria-label={`${k} volatility`} type="number" step={0.5} className={n} value={a.classes[k].volatilityPct} onChange={(e) => setA((x) => ({ ...x, classes: { ...x.classes, [k]: { ...x.classes[k], volatilityPct: Number(e.target.value) } } }))} />
              </td>
              <td className="max-w-md text-[10px] text-muted-foreground">{a.classes[k].source}</td>
            </tr>
          ))}
          <tr className="border-t border-border/50 align-top">
            <td className="py-1.5">Inflation</td>
            <td>
              <input aria-label="Inflation" type="number" step={0.1} className={n} value={a.inflationPct} onChange={(e) => setA((x) => ({ ...x, inflationPct: Number(e.target.value) }))} />
            </td>
            <td />
            <td className="max-w-md text-[10px] text-muted-foreground">{a.inflationSource}</td>
          </tr>
          <tr className="border-t border-border/50 align-top">
            <td className="py-1.5">Stock/bond correlation</td>
            <td>
              <input aria-label="Correlation" type="number" step={0.05} className={n} value={a.stockBondCorrelation} onChange={(e) => setA((x) => ({ ...x, stockBondCorrelation: Number(e.target.value) }))} />
            </td>
            <td />
            <td className="max-w-md text-[10px] text-muted-foreground">{a.correlationSource}</td>
          </tr>
        </tbody>
      </table>
      <div className="mt-2 flex gap-2">
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => reset.mutate()}>
          Reset to defaults
        </Button>
      </div>
    </section>
  );
}

export function AssumptionsAndData() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["assumptions"], queryFn: () => api<{ assumptions: Assumptions; defaults: Assumptions }>("/api/finances/assumptions") });
  const del = useMutation({
    mutationFn: () => api("/api/finances/export", { method: "DELETE" }),
    onSuccess: async () => {
      toast.success("All financial data deleted");
      await qc.invalidateQueries();
    },
  });
  return (
    <div className="space-y-3">
      {q.isPending ? <LoadingRows rows={5} /> : q.isError ? <ErrorState error={q.error} /> : <Editor key={JSON.stringify(q.data.assumptions)} initial={q.data.assumptions} defaults={q.data.defaults} />}
      <section className="rounded-md border border-border bg-background/40 p-3 text-xs">
        <h3 className="font-semibold">Your data</h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground">Income, balances and transactions are encrypted at rest (AES-256-GCM, DATA_ENCRYPTION_KEY). Financial values are never logged.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <a href="/api/finances/export" className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 hover:bg-accent">
            <Download className="size-3.5" /> Export everything (JSON)
          </a>
          <a href="/api/finances/export?format=csv" className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 hover:bg-accent">
            <Download className="size-3.5" /> Transactions (CSV)
          </a>
          <Button
            size="sm"
            variant="ghost"
            className="text-down"
            onClick={() => {
              if (window.confirm("Delete ALL your financial data (profile, transactions, plan versions)? This cannot be undone. Export first if you want a copy.")) del.mutate();
            }}
          >
            <Trash2 /> Delete all my financial data
          </Button>
        </div>
      </section>
    </div>
  );
}
