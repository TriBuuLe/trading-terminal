"use client";

import { Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { overrideWarning, riskScore } from "@/lib/planner/core";
import type { AccountType, Profile } from "@/lib/planner/types";
import { cn } from "@/lib/utils";

/** Editable sections of the financial profile, shared by the onboarding wizard and "My finances". */

const uid = () => Math.random().toString(36).slice(2, 10);
const inp = "h-7 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-ring";
const numInp = cn(inp, "num w-28 text-right");

export function emptyProfile(): Profile {
  return {
    country: "CA",
    region: "ON",
    age: 22,
    crossBorder: false,
    incomes: [],
    expenses: [],
    debts: [],
    accounts: [],
    goals: [],
    risk: { horizonYears: 10, drawdownReaction: 2, incomeStability: 2, experience: 1 },
    riskOverride: null,
    employerMatchPct: 0,
    sandboxPct: 7.5,
    highInterestAprPct: 8,
  };
}

function Num({ value, onChange, step = 1, label, className }: { value: number; onChange: (n: number) => void; step?: number; label: string; className?: string }) {
  return (
    <input
      aria-label={label}
      type="number"
      step={step}
      min={0}
      className={cn(numInp, className)}
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
    />
  );
}

function Section({ title, hint, children, onAdd, addLabel }: { title: string; hint?: ReactNode; children: ReactNode; onAdd?: () => void; addLabel?: string }) {
  return (
    <section className="rounded-md border border-border bg-background/40 p-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold">{title}</h3>
          {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
        </div>
        {onAdd && (
          <button type="button" onClick={onAdd} className="flex shrink-0 items-center gap-1 rounded border border-border px-2 py-1 text-[11px] hover:bg-accent">
            <Plus className="size-3" /> {addLabel ?? "Add"}
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function Del({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground">
      <Trash2 className="size-3.5" />
    </button>
  );
}

type Set = (fn: (p: Profile) => Profile) => void;

export function BasicsSection({ p, set }: { p: Profile; set: Set }) {
  return (
    <Section title="About you" hint="Country decides which account types the plan uses (TFSA/RRSP/FHSA vs 401(k)/IRA/HSA).">
      <div className="flex flex-wrap items-end gap-3 text-xs">
        <label className="grid gap-1">
          Country
          <select className={inp} value={p.country} onChange={(e) => set((x) => ({ ...x, country: e.target.value as Profile["country"] }))}>
            <option value="CA">Canada</option>
            <option value="US">United States</option>
          </select>
        </label>
        <label className="grid gap-1">
          Province / state
          <input className={cn(inp, "w-20 uppercase")} value={p.region} onChange={(e) => set((x) => ({ ...x, region: e.target.value.toUpperCase().slice(0, 20) }))} />
        </label>
        <label className="grid gap-1">
          Age
          <Num label="Age" value={p.age} onChange={(n) => set((x) => ({ ...x, age: Math.round(n) }))} className="w-16" />
        </label>
        <label className="flex items-center gap-1.5 pb-1.5">
          <input type="checkbox" checked={p.crossBorder} onChange={(e) => set((x) => ({ ...x, crossBorder: e.target.checked }))} />I may move between Canada and the US, or hold accounts in both
        </label>
      </div>
    </Section>
  );
}

export function IncomeSection({ p, set }: { p: Profile; set: Set }) {
  const upd = (id: string, patch: Partial<Profile["incomes"][number]>) => set((x) => ({ ...x, incomes: x.incomes.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
  return (
    <Section
      title="Income (take-home, after tax)"
      hint="Add co-op terms and school-year jobs as separate lines with their start/end months; the plan averages the next 12 months."
      onAdd={() => set((x) => ({ ...x, incomes: [...x.incomes, { id: uid(), name: "Job", amount: 0, frequency: "biweekly", kind: "salary", startMonth: null, endMonth: null }] }))}
    >
      {p.incomes.length === 0 && <p className="text-[11px] text-muted-foreground">No income yet.</p>}
      <div className="space-y-1.5">
        {p.incomes.map((i) => (
          <div key={i.id} className="flex flex-wrap items-center gap-2 text-xs">
            <input aria-label="Income name" className={cn(inp, "w-36")} value={i.name} onChange={(e) => upd(i.id, { name: e.target.value })} />
            <Num label="Amount per period" value={i.amount} onChange={(n) => upd(i.id, { amount: n })} />
            <select aria-label="Frequency" className={inp} value={i.frequency} onChange={(e) => upd(i.id, { frequency: e.target.value as typeof i.frequency })}>
              <option value="weekly">weekly</option>
              <option value="biweekly">every 2 weeks</option>
              <option value="semimonthly">twice a month</option>
              <option value="monthly">monthly</option>
              <option value="annual">yearly</option>
            </select>
            <select aria-label="Kind" className={inp} value={i.kind} onChange={(e) => upd(i.id, { kind: e.target.value as typeof i.kind })}>
              <option value="salary">job</option>
              <option value="coop">co-op term</option>
              <option value="bonus">bonus</option>
              <option value="other">other</option>
            </select>
            <span className="text-muted-foreground">from</span>
            <input aria-label="Start month" type="month" className={inp} value={i.startMonth ?? ""} onChange={(e) => upd(i.id, { startMonth: e.target.value || null })} />
            <span className="text-muted-foreground">to</span>
            <input aria-label="End month" type="month" className={inp} value={i.endMonth ?? ""} onChange={(e) => upd(i.id, { endMonth: e.target.value || null })} />
            <label className="flex items-center gap-1 text-muted-foreground">
              raise %/yr <Num label="Raise percent" value={i.annualRaisePct ?? 0} step={0.5} onChange={(n) => upd(i.id, { annualRaisePct: n })} className="w-14" />
            </label>
            <Del label="Remove income" onClick={() => set((x) => ({ ...x, incomes: x.incomes.filter((y) => y.id !== i.id) }))} />
          </div>
        ))}
      </div>
    </Section>
  );
}

const COMMON_EXPENSES: [string, "need" | "want"][] = [
  ["Rent", "need"],
  ["Groceries", "need"],
  ["Phone & internet", "need"],
  ["Transportation", "need"],
  ["Utilities", "need"],
  ["Insurance", "need"],
  ["Dining out", "want"],
  ["Subscriptions", "want"],
  ["Shopping", "want"],
  ["Fun", "want"],
];

export function ExpenseSection({ p, set }: { p: Profile; set: Set }) {
  const upd = (id: string, patch: Partial<Profile["expenses"][number]>) => set((x) => ({ ...x, expenses: x.expenses.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
  const missing = COMMON_EXPENSES.filter(([c]) => !p.expenses.some((e) => e.category.toLowerCase() === c.toLowerCase()));
  return (
    <Section
      title="Monthly spending"
      hint="Needs = must pay; wants = could cut. You can also import bank CSVs under Transactions to see real numbers."
      onAdd={() => set((x) => ({ ...x, expenses: [...x.expenses, { id: uid(), category: "Other", monthly: 0, kind: "want" }] }))}
    >
      <div className="space-y-1.5">
        {p.expenses.map((e) => (
          <div key={e.id} className="flex items-center gap-2 text-xs">
            <input aria-label="Category" className={cn(inp, "w-40")} value={e.category} onChange={(ev) => upd(e.id, { category: ev.target.value })} />
            <Num label="Monthly amount" value={e.monthly} onChange={(n) => upd(e.id, { monthly: n })} />
            <select aria-label="Need or want" className={inp} value={e.kind} onChange={(ev) => upd(e.id, { kind: ev.target.value as "need" | "want" })}>
              <option value="need">need</option>
              <option value="want">want</option>
            </select>
            <Del label="Remove expense" onClick={() => set((x) => ({ ...x, expenses: x.expenses.filter((y) => y.id !== e.id) }))} />
          </div>
        ))}
      </div>
      {missing.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {missing.map(([c, k]) => (
            <button
              key={c}
              type="button"
              onClick={() => set((x) => ({ ...x, expenses: [...x.expenses, { id: uid(), category: c, monthly: 0, kind: k }] }))}
              className="rounded border border-dashed border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
            >
              + {c}
            </button>
          ))}
        </div>
      )}
    </Section>
  );
}

export function DebtSection({ p, set }: { p: Profile; set: Set }) {
  const upd = (id: string, patch: Partial<Profile["debts"][number]>) => set((x) => ({ ...x, debts: x.debts.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
  return (
    <Section title="Debts" hint="Balance, interest rate (APR %) and minimum monthly payment." onAdd={() => set((x) => ({ ...x, debts: [...x.debts, { id: uid(), name: "Credit card", balance: 0, aprPct: 20, minPayment: 0 }] }))}>
      {p.debts.length === 0 && <p className="text-[11px] text-muted-foreground">No debts. Nice.</p>}
      <div className="space-y-1.5">
        {p.debts.map((d) => (
          <div key={d.id} className="flex flex-wrap items-center gap-2 text-xs">
            <input aria-label="Debt name" className={cn(inp, "w-40")} value={d.name} onChange={(e) => upd(d.id, { name: e.target.value })} />
            <span className="text-muted-foreground">balance</span>
            <Num label="Balance" value={d.balance} onChange={(n) => upd(d.id, { balance: n })} />
            <span className="text-muted-foreground">APR %</span>
            <Num label="APR" value={d.aprPct} step={0.1} onChange={(n) => upd(d.id, { aprPct: n })} className="w-16" />
            <span className="text-muted-foreground">min/mo</span>
            <Num label="Minimum payment" value={d.minPayment} onChange={(n) => upd(d.id, { minPayment: n })} className="w-20" />
            <Del label="Remove debt" onClick={() => set((x) => ({ ...x, debts: x.debts.filter((y) => y.id !== d.id) }))} />
          </div>
        ))}
      </div>
    </Section>
  );
}

const ACCOUNT_TYPES: Record<Profile["country"], AccountType[]> = {
  CA: ["CASH", "HISA", "TFSA", "RRSP", "FHSA", "TAXABLE"],
  US: ["CASH", "HISA", "ROTH_IRA", "TRADITIONAL_IRA", "401K", "HSA", "TAXABLE"],
};

export function AccountSection({ p, set }: { p: Profile; set: Set }) {
  const upd = (id: string, patch: Partial<Profile["accounts"][number]>) => set((x) => ({ ...x, accounts: x.accounts.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
  return (
    <Section title="Accounts & savings" hint="Cash, savings, and investment accounts with their type." onAdd={() => set((x) => ({ ...x, accounts: [...x.accounts, { id: uid(), name: "Chequing", type: "CASH", balance: 0 }] }))}>
      {p.accounts.length === 0 && <p className="text-[11px] text-muted-foreground">No accounts yet.</p>}
      <div className="space-y-1.5">
        {p.accounts.map((a) => (
          <div key={a.id} className="flex items-center gap-2 text-xs">
            <input aria-label="Account name" className={cn(inp, "w-40")} value={a.name} onChange={(e) => upd(a.id, { name: e.target.value })} />
            <select aria-label="Account type" className={inp} value={a.type} onChange={(e) => upd(a.id, { type: e.target.value as AccountType })}>
              {[...new Set([...ACCOUNT_TYPES[p.country], a.type])].map((t) => (
                <option key={t} value={t}>
                  {t.replace("_", " ")}
                </option>
              ))}
            </select>
            <Num label="Balance" value={a.balance} onChange={(n) => upd(a.id, { balance: n })} />
            <Del label="Remove account" onClick={() => set((x) => ({ ...x, accounts: x.accounts.filter((y) => y.id !== a.id) }))} />
          </div>
        ))}
      </div>
    </Section>
  );
}

export function GoalSection({ p, set }: { p: Profile; set: Set }) {
  const upd = (id: string, patch: Partial<Profile["goals"][number]>) => set((x) => ({ ...x, goals: x.goals.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
  const nextYear = `${new Date().getFullYear() + 1}-12`;
  return (
    <Section
      title="Goals"
      hint="Targets in today's dollars. Priority 1 is funded first."
      onAdd={() => set((x) => ({ ...x, goals: [...x.goals, { id: uid(), name: "New goal", kind: "other", target: 5000, targetDate: nextYear, priority: x.goals.length + 1, current: 0 }] }))}
      addLabel="Add goal"
    >
      {p.goals.length === 0 && <p className="text-[11px] text-muted-foreground">Add at least one goal, e.g. an emergency fund.</p>}
      <div className="space-y-1.5">
        {p.goals.map((g) => (
          <div key={g.id} className="flex flex-wrap items-center gap-2 text-xs">
            <input aria-label="Goal name" className={cn(inp, "w-40")} value={g.name} onChange={(e) => upd(g.id, { name: e.target.value })} />
            <select aria-label="Goal type" className={inp} value={g.kind} onChange={(e) => upd(g.id, { kind: e.target.value as typeof g.kind })}>
              {["emergency", "car", "house", "retirement", "long_term", "education", "other"].map((k) => (
                <option key={k} value={k}>
                  {k.replace("_", " ")}
                </option>
              ))}
            </select>
            <span className="text-muted-foreground">target</span>
            <Num label="Target amount" value={g.target} onChange={(n) => upd(g.id, { target: n })} />
            <span className="text-muted-foreground">by</span>
            <input aria-label="Target date" type="month" className={inp} value={g.targetDate} onChange={(e) => upd(g.id, { targetDate: e.target.value || nextYear })} />
            <span className="text-muted-foreground">saved</span>
            <Num label="Already saved" value={g.current} onChange={(n) => upd(g.id, { current: n })} className="w-24" />
            <span className="text-muted-foreground">priority</span>
            <Num label="Priority" value={g.priority} onChange={(n) => upd(g.id, { priority: Math.max(1, Math.round(n)) })} className="w-12" />
            <Del label="Remove goal" onClick={() => set((x) => ({ ...x, goals: x.goals.filter((y) => y.id !== g.id) }))} />
          </div>
        ))}
      </div>
    </Section>
  );
}

function Choice<T extends number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map(([v, l]) => (
        <button key={v} type="button" onClick={() => onChange(v)} className={cn("rounded border px-2 py-1 text-[11px]", value === v ? "border-series-1 bg-series-1/15" : "border-border text-muted-foreground hover:text-foreground")}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function RiskSection({ p, set }: { p: Profile; set: Set }) {
  const score = riskScore(p.risk);
  const warn = overrideWarning(p.risk, p.riskOverride);
  const r = (patch: Partial<Profile["risk"]>) => set((x) => ({ ...x, risk: { ...x.risk, ...patch } }));
  return (
    <Section title="Risk profile" hint="Sets the stock/bond mix for long-term money. Short-term goals stay in cash regardless.">
      <div className="space-y-2.5 text-xs">
        <div>
          <p className="mb-1">When will you need most of your invested money?</p>
          <Choice value={p.risk.horizonYears} onChange={(v) => r({ horizonYears: v })} options={[[2, "< 4 years"], [6, "4–7 years"], [10, "8–14 years"], [20, "15+ years"]]} />
        </div>
        <div>
          <p className="mb-1">Your investments drop 25% in a few months. You…</p>
          <Choice value={p.risk.drawdownReaction} onChange={(v) => r({ drawdownReaction: v })} options={[[1, "sell everything"], [2, "sell some"], [3, "hold"], [4, "buy more"]]} />
        </div>
        <div>
          <p className="mb-1">How stable is your income?</p>
          <Choice value={p.risk.incomeStability} onChange={(v) => r({ incomeStability: v })} options={[[1, "irregular (co-op, gig, commission)"], [2, "mostly stable"], [3, "very stable"]]} />
        </div>
        <div>
          <p className="mb-1">Investing experience</p>
          <Choice value={p.risk.experience} onChange={(v) => r({ experience: v })} options={[[1, "none"], [2, "some"], [3, "experienced"]]} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span>
            Risk score from your answers: <b className="num">{score}</b>/10
          </span>
          <span className="text-muted-foreground">· override:</span>
          <select aria-label="Risk override" className={inp} value={p.riskOverride ?? ""} onChange={(e) => set((x) => ({ ...x, riskOverride: e.target.value ? Number(e.target.value) : null }))}>
            <option value="">use my answers</option>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        {warn && <p className="rounded bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300">{warn}</p>}
      </div>
    </Section>
  );
}

export function SettingsSection({ p, set }: { p: Profile; set: Set }) {
  return (
    <Section title="Plan settings">
      <div className="flex flex-wrap items-center gap-4 text-xs">
        <label className="flex items-center gap-1.5" title="Share of long-term investing money you may use for individual stock picking in the paper terminal">
          Stock-picking sandbox <Num label="Sandbox percent" value={p.sandboxPct} step={0.5} onChange={(n) => set((x) => ({ ...x, sandboxPct: n }))} className="w-16" />%
        </label>
        <label className="flex items-center gap-1.5">
          High-interest debt at or above <Num label="High interest APR" value={p.highInterestAprPct} step={0.5} onChange={(n) => set((x) => ({ ...x, highInterestAprPct: n }))} className="w-16" />% APR
        </label>
        <label className="flex items-center gap-1.5">
          Employer match <Num label="Employer match percent" value={p.employerMatchPct ?? 0} step={0.5} onChange={(n) => set((x) => ({ ...x, employerMatchPct: n }))} className="w-16" />% of pay
        </label>
      </div>
    </Section>
  );
}

export const WIZARD_STEPS = [
  { key: "basics", label: "About you", C: BasicsSection },
  { key: "income", label: "Income", C: IncomeSection },
  { key: "spending", label: "Spending", C: ExpenseSection },
  { key: "debts", label: "Debts", C: DebtSection },
  { key: "accounts", label: "Accounts", C: AccountSection },
  { key: "goals", label: "Goals", C: GoalSection },
  { key: "risk", label: "Risk", C: RiskSection },
] as const;
