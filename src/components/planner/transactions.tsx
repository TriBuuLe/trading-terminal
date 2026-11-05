"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { CATEGORY_RULES, flipSigns, type ParsedTx } from "@/lib/planner/csv";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingRows, Tag } from "../terminal/bits";

const CATEGORIES = [...new Set([...CATEGORY_RULES.map(([c]) => c), "Other", "Uncategorized"])];

interface StoredTx {
  id: number;
  date: string;
  description: string;
  amount: number;
  category: string;
}

function CategorySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const opts = CATEGORIES.includes(value) ? CATEGORIES : [value, ...CATEGORIES];
  return (
    <select aria-label="Category" value={value} onChange={(e) => onChange(e.target.value)} className="h-6 rounded border border-input bg-background px-1 text-[11px]">
      {opts.map((c) => (
        <option key={c}>{c}</option>
      ))}
    </select>
  );
}

export function Transactions() {
  const qc = useQueryClient();
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [preview, setPreview] = useState<{ rows: ParsedTx[]; skipped: number; looksLikeCard: boolean } | null>(null);
  // Credit-card exports list purchases as positive; flip so money out is negative.
  const [cardMode, setCardMode] = useState(false);
  const list = useQuery({ queryKey: ["transactions", month], queryFn: () => api<StoredTx[]>(`/api/finances/transactions?month=${month}`) });
  const months = useQuery({ queryKey: ["transactions", "months"], queryFn: () => api<{ month: string; count: number }[]>("/api/finances/transactions?months=1") });
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["transactions"] }),
      qc.invalidateQueries({ queryKey: ["checkin"] }),
      qc.invalidateQueries({ queryKey: ["networth-history"] }),
      qc.invalidateQueries({ queryKey: ["plan"] }),
      qc.invalidateQueries({ queryKey: ["summary"] }),
    ]);
  const shown = preview ? (cardMode ? flipSigns(preview.rows) : preview.rows) : [];

  const upload = async (file: File) => {
    if (file.size > 5_000_000) return toast.error("File too large (5 MB max)");
    try {
      const r = await api<{ rows: ParsedTx[]; skipped: number; looksLikeCard: boolean }>("/api/finances/transactions/preview", { method: "POST", body: { csv: await file.text() } });
      setPreview(r);
      setCardMode(r.looksLikeCard);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const save = useMutation({
    mutationFn: (rows: ParsedTx[]) =>
      api<{ saved: number; duplicates: number }>("/api/finances/transactions", { method: "POST", body: { rows: rows.map(({ date, description, amount, category }) => ({ date, description, amount, category })) } }),
    onSuccess: async (r) => {
      toast.success(`Saved ${r.saved} transactions (encrypted)${r.duplicates ? `; skipped ${r.duplicates} already saved` : ""}`);
      setPreview(null);
      await refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const monthAction = (method: "PATCH" | "DELETE") =>
    api(`/api/finances/transactions${method === "DELETE" ? `?month=${month}` : ""}`, { method, body: method === "PATCH" ? { flipMonth: month } : undefined })
      .then(async () => {
        toast.success(method === "PATCH" ? `Flipped signs for ${month}` : `Deleted ${month}'s transactions`);
        await refresh();
      })
      .catch((e: Error) => toast.error(e.message));

  return (
    <div className="space-y-3">
      <section className="rounded-md border border-border bg-background/40 p-3">
        <h3 className="text-xs font-semibold">Import a bank or credit-card CSV</h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Download a CSV from your bank&apos;s website (no bank logins here). Card and reference numbers are stripped; categories are suggested from merchant names and you confirm
          them before anything is saved. Stored encrypted.
        </p>
        <label className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent">
          <Upload className="size-3.5" /> Choose CSV…
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
        </label>
      </section>

      {preview && (
        <section className="rounded-md border border-series-1/40 bg-background/40 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold">
              Review {preview.rows.length} transactions{preview.skipped ? ` (${preview.skipped} rows skipped: unreadable)` : ""}
            </h3>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>
                Cancel
              </Button>
              <Button size="sm" disabled={save.isPending || preview.rows.length === 0} onClick={() => save.mutate(shown)}>
                Confirm & save
              </Button>
            </div>
          </div>
          <label className={cn("mb-2 flex items-start gap-2 rounded p-2 text-[11px]", cardMode ? "bg-series-1/10" : "bg-muted/40")}>
            <input type="checkbox" className="mt-0.5" checked={cardMode} onChange={(e) => setCardMode(e.target.checked)} />
            <span>
              <b>This is a credit-card statement</b> (purchases are listed as positive numbers). Flips the signs so purchases count as spending (−) and your card payments as
              transfers.
              {preview.looksLikeCard && <span className="text-muted-foreground"> Detected automatically: most amounts are positive and there&apos;s a card payment line.</span>}
            </span>
          </label>
          <p className="mb-1 text-[10px] text-muted-foreground">Green = money in · white = money out. Re-uploading a file is safe: transactions already saved are skipped.</p>
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-[11px]">
              <tbody>
                {shown.map((r, i) => (
                  <tr key={i} className="border-t border-border/50">
                    <td className="num py-0.5 text-muted-foreground">{r.date}</td>
                    <td className="max-w-72 truncate">{r.description}</td>
                    <td className={cn("num text-right", r.amount < 0 ? "" : "text-up")}>{money(r.amount)}</td>
                    <td className="pl-2">
                      <CategorySelect value={r.category} onChange={(c) => setPreview((p) => p && { ...p, rows: p.rows.map((x, j) => (j === i ? { ...x, category: c, confidence: "rule" } : x)) })} />
                      {r.confidence === "none" && <Tag tone="warn" className="ml-1">check</Tag>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="rounded-md border border-border bg-background/40 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold">Saved transactions (one month at a time)</h3>
          <input aria-label="Month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-7 rounded-md border border-input bg-background px-2 text-xs" />
        </div>
        {(months.data?.length ?? 0) > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-1 text-[11px]">
            <span className="text-muted-foreground">Months saved:</span>
            {months.data!.map((m) => (
              <button
                key={m.month}
                onClick={() => setMonth(m.month)}
                className={cn("rounded border px-1.5 py-0.5", m.month === month ? "border-series-1 bg-series-1/15" : "border-border text-muted-foreground hover:text-foreground")}
              >
                {m.month} · {m.count}
              </button>
            ))}
          </div>
        )}
        {list.data && list.data.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2 text-[11px]">
            <button className="text-series-1 hover:underline" onClick={() => void monthAction("PATCH")} title="For a credit-card import that was saved with purchases as positive">
              Flip signs for {month}
            </button>
            <button
              className="text-down hover:underline"
              onClick={() => {
                if (window.confirm(`Delete all ${list.data.length} transactions for ${month}?`)) void monthAction("DELETE");
              }}
            >
              Delete {month}
            </button>
          </div>
        )}
        {list.isPending ? (
          <LoadingRows rows={4} className="p-0" />
        ) : list.isError ? (
          <ErrorState error={list.error} compact />
        ) : list.data.length === 0 ? (
          <EmptyState title={`No transactions for ${month}`} />
        ) : (
          <table className="w-full text-[11px]">
            <tbody>
              {list.data.map((t) => (
                <tr key={t.id} className="border-t border-border/50">
                  <td className="num py-0.5 text-muted-foreground">{t.date}</td>
                  <td className="max-w-72 truncate">{t.description}</td>
                  <td className={cn("num text-right", t.amount < 0 ? "" : "text-up")}>{money(t.amount)}</td>
                  <td className="pl-2">
                    <CategorySelect
                      value={t.category}
                      onChange={(c) =>
                        void api("/api/finances/transactions", { method: "PATCH", body: { id: t.id, category: c } })
                          .then(refresh)
                          .catch((e: Error) => toast.error(e.message))
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
