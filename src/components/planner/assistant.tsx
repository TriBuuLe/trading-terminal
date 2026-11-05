"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Send } from "lucide-react";
import { Fragment, useState } from "react";
import { toast } from "sonner";
import { create } from "zustand";
import { api } from "@/lib/api";
import { applyActions, type Action } from "@/lib/ai/actions";
import type { Profile } from "@/lib/planner/types";
import type { Progress } from "@/lib/planner/yearplan";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LoadingRows } from "../terminal/bits";

interface Turn {
  role: "user" | "assistant";
  text: string;
  actions?: { action: Action; summary: string }[];
  rejected?: string[];
  ungrounded?: string[];
  model?: string;
  applied?: boolean;
}

/** Kept while you switch tabs (not saved anywhere). */
const useChat = create<{ turns: Turn[]; set: (fn: (t: Turn[]) => Turn[]) => void }>((set) => ({ turns: [], set: (fn) => set((s) => ({ turns: fn(s.turns) })) }));

const PROMPTS = [
  "Set up my 2026 plan: save and invest targets I can actually hit, and trim my wants.",
  "Am I on track this year? What's behind and why?",
  "Where is my money going, and what are the 3 easiest cuts?",
  "Check my income lines against my paychecks and fix anything that's off.",
  "Turn my long-term goals into a monthly save + invest pace.",
];

/** **bold** and bullet lines, nothing else. */
function Rich({ text }: { text: string }) {
  return (
    <div className="space-y-1 text-xs leading-relaxed">
      {text.split("\n").map((line, k) => {
        const t = line.replace(/^#{1,6}\s*/, "");
        const bullet = /^\s*[*-]\s+/.test(t);
        const parts = t.replace(/^\s*[*-]\s+/, "").split(/(\*\*[^*]+\*\*)/g);
        const body = parts.map((p, j) => (p.startsWith("**") && p.endsWith("**") ? <b key={j}>{p.slice(2, -2)}</b> : <Fragment key={j}>{p}</Fragment>));
        if (!t.trim()) return null;
        return bullet ? (
          <div key={k} className="flex gap-1.5 pl-1">
            <span className="text-muted-foreground">•</span>
            <span>{body}</span>
          </div>
        ) : (
          <p key={k} className={/^#{1,6}\s/.test(line) ? "font-semibold" : undefined}>
            {body}
          </p>
        );
      })}
    </div>
  );
}

function Changes({ turn, index }: { turn: Turn; index: number }) {
  const qc = useQueryClient();
  const setTurns = useChat((s) => s.set);
  const [skip, setSkip] = useState<number[]>([]);
  const chosen = (turn.actions ?? []).filter((_, k) => !skip.includes(k));
  const apply = useMutation({
    mutationFn: async () => {
      const [{ profile }, year] = await Promise.all([api<{ profile: Profile | null }>("/api/finances/profile"), api<{ year: number; progress: Progress | null } | null>("/api/finances/year")]);
      if (!profile) throw new Error("No profile yet");
      const today = new Date().toISOString().slice(0, 10);
      // Annual amounts fill the months still ahead; months with statements keep their plan.
      const first = year?.progress?.remaining.months[0];
      const openFrom = first ? Number(first.slice(5, 7)) - 1 : 0;
      const next = applyActions(profile, chosen.map((c) => c.action), year?.year ?? Number(today.slice(0, 4)), today, openFrom);
      await api("/api/finances/profile", { method: "PUT", body: next });
    },
    onSuccess: async () => {
      toast.success(`Applied ${chosen.length} change${chosen.length === 1 ? "" : "s"}`);
      setTurns((t) => t.map((x, k) => (k === index ? { ...x, applied: true } : x)));
      await Promise.all(["profile", "plan", "year", "summary", "paychecks", "checkin"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
    },
    onError: (e) => toast.error(e.message),
  });
  if (!turn.actions?.length) return null;
  return (
    <div className="mt-2 rounded-md border border-border bg-background/60 p-2">
      <div className="mb-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Proposed changes</div>
      <ul className="space-y-0.5 text-xs">
        {turn.actions.map((a, k) => (
          <li key={k}>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-0.5" disabled={turn.applied} checked={!skip.includes(k)} onChange={(e) => setSkip((s) => (e.target.checked ? s.filter((x) => x !== k) : [...s, k]))} />
              <span className="num">
                {a.summary}
                {a.action.why && <span className="text-muted-foreground"> · {a.action.why}</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" disabled={turn.applied || apply.isPending || chosen.length === 0} onClick={() => apply.mutate()}>
          {turn.applied ? "Applied" : apply.isPending ? "Applying…" : `Apply ${chosen.length}`}
        </Button>
        <span className="text-[10px] text-muted-foreground">Saved to My finances like a manual edit. Review it there.</span>
      </div>
    </div>
  );
}

export function Assistant() {
  const status = useQuery({ queryKey: ["assistant-status"], queryFn: () => api<{ ok: boolean; reason?: string }>("/api/finances/assistant") });
  const { turns, set } = useChat();
  const [draft, setDraft] = useState("");
  const ask = useMutation({
    mutationFn: (messages: Turn[]) =>
      api<{ reply: string; actions: Turn["actions"]; rejected: string[]; ungrounded: string[]; model: string }>("/api/finances/assistant", {
        method: "POST",
        body: { messages: messages.map((m) => ({ role: m.role, text: m.text })) },
      }),
    onSuccess: (r) => set((t) => [...t, { role: "assistant", text: r.reply, actions: r.actions, rejected: r.rejected, ungrounded: r.ungrounded, model: r.model }]),
    onError: (e) => toast.error(e.message),
  });
  const send = (text: string) => {
    const q = text.trim();
    if (!q || ask.isPending) return;
    const next = [...turns, { role: "user" as const, text: q }];
    set(() => next);
    setDraft("");
    ask.mutate(next);
  };

  if (status.isPending) return <LoadingRows rows={4} />;
  if (status.data && !status.data.ok)
    return (
      <div className="rounded-md border border-border bg-background/40 p-3 text-xs">
        <h3 className="font-semibold">Assistant unavailable</h3>
        <p className="mt-1 text-muted-foreground">{status.data.reason}</p>
      </div>
    );

  return (
    <div className="flex min-h-[70vh] flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Assistant</h2>
        <span className="text-[10px] text-muted-foreground">
          Reads your plan, statements, income and goals (Gemini free tier; people&apos;s names and account numbers removed). Changes are proposals until you apply them.
        </span>
      </div>
      <div className="flex-1 space-y-3">
        {turns.length === 0 && (
          <div className="flex flex-wrap gap-1.5">
            {PROMPTS.map((p) => (
              <button key={p} type="button" onClick={() => send(p)} className="rounded-md border border-border bg-background/40 px-2.5 py-1.5 text-left text-xs hover:bg-accent">
                {p}
              </button>
            ))}
          </div>
        )}
        {turns.map((t, k) => (
          <div key={k} className={cn("rounded-md border p-3", t.role === "user" ? "ml-auto max-w-[80%] border-series-1/30 bg-series-1/10 text-xs" : "border-border bg-background/40")}>
            {t.role === "user" ? (
              <p className="whitespace-pre-wrap">{t.text}</p>
            ) : (
              <>
                <Rich text={t.text} />
                {!!t.ungrounded?.length && (
                  <p className="mt-2 flex gap-1 text-[10px] text-amber-300">
                    <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                    Not found in your data, double-check: {t.ungrounded.join(", ")}
                  </p>
                )}
                {!!t.rejected?.length && <p className="mt-1 text-[10px] text-muted-foreground">Skipped {t.rejected.length} invalid proposed change{t.rejected.length === 1 ? "" : "s"}.</p>}
                <Changes turn={t} index={k} />
                {t.model && <p className="mt-1 text-right text-[9px] text-muted-foreground">{t.model}</p>}
              </>
            )}
          </div>
        ))}
        {ask.isPending && <LoadingRows rows={3} />}
      </div>
      <form
        className="sticky bottom-0 flex gap-2 rounded-md border border-border bg-panel/95 p-2 backdrop-blur"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <textarea
          aria-label="Ask the assistant"
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(draft);
            }
          }}
          placeholder="Ask about your money, or ask it to set something up…"
          className="min-h-9 flex-1 resize-none rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus:border-ring"
        />
        <Button type="submit" size="sm" disabled={!draft.trim() || ask.isPending} aria-label="Send">
          <Send className="size-3.5" />
        </Button>
        {turns.length > 0 && (
          <Button type="button" size="sm" variant="ghost" onClick={() => set(() => [])}>
            Clear
          </Button>
        )}
      </form>
    </div>
  );
}
