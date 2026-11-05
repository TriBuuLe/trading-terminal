"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useNow } from "@/hooks/use-now";
import { api } from "@/lib/api";
import { SPENDING_CATEGORIES, SPENDING_CATEGORY_NAMES, defaultKind } from "@/lib/planner/categories";
import { matchPlanCategory } from "@/lib/planner/spending";
import { addMonths, incomeInMonth, isActive, monthlyEquivalent, nextPaycheck, overrideWarning, paychecks, riskScore } from "@/lib/planner/core";
import { lineMatchesPattern, matchIncomeLine, WEEKDAYS, type PayPattern } from "@/lib/planner/paychecks";
import { derivedTaxFacts, netIncome } from "@/lib/planner/net";
import { TAX_YEARS } from "@/lib/tax/rules";
import type { YearTax } from "@/lib/tax/calc";
import type { YearSummary } from "@/lib/planner/summary";
import type { AccountType, Profile } from "@/lib/planner/types";
import { addBudgetRow, fillFrom, newYearPlan, plannedMonths, spreadAnnual, sum, type YearPlan } from "@/lib/planner/yearplan";
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

/** Optional number: empty means "not set" (so a calculated default can be used). */
function OptNum({ value, onChange, label, placeholder }: { value: number | undefined; onChange: (n: number | undefined) => void; label: string; placeholder?: string }) {
  return (
    <input
      aria-label={label}
      type="number"
      min={0}
      className={numInp}
      placeholder={placeholder}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
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
    <Section
      title="About you"
      hint="Country decides which account types and tax rules the plan uses (TFSA/RRSP/FHSA vs 401(k)/IRA/HSA). For before-tax US income, the state is used for state income tax where rules are verified (currently North Carolina); for other states, enter a rate estimate under Tax facts. Canadian tax estimates aren't built yet."
    >
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

const ymOf = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const usd = (x: number) => `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Estimated tax per calendar year on "before tax" income. */
function TaxBreakdown({ taxes }: { taxes: YearTax[] }) {
  return (
    <div className="mt-2 overflow-x-auto rounded border border-border p-2">
      <p className="mb-1 text-[11px] font-medium">Estimated taxes on before-tax pay (whole calendar year)</p>
      <table className="w-full text-[11px]">
        <thead className="text-[10px] text-muted-foreground uppercase">
          <tr className="text-right">
            <th className="text-left font-medium">Year</th>
            <th className="font-medium">Gross</th>
            <th className="font-medium">Federal</th>
            <th className="font-medium">Social Security</th>
            <th className="font-medium">Medicare</th>
            <th className="font-medium">State</th>
            <th className="font-medium">Take-home</th>
            <th className="font-medium">Effective</th>
            <th className="font-medium" title="Federal bracket + state rate on your next dollar">Marginal</th>
          </tr>
        </thead>
        <tbody className="num">
          {taxes.map((t) => (
            <tr key={t.year} className="border-t border-border/50 text-right">
              <td className="py-0.5 text-left">{t.year}</td>
              <td>{usd(t.gross)}</td>
              <td>−{usd(t.federal)}</td>
              <td>−{usd(t.socialSecurity)}</td>
              <td>−{usd(t.medicare + t.additionalMedicare)}</td>
              <td>{t.state === null ? "not modeled" : `−${usd(t.state)}`}</td>
              <td className="text-up">{usd(t.net)}</td>
              <td>{t.effectivePct.toFixed(1)}%</td>
              <td>{t.marginalPct.toFixed(2)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[10px] text-muted-foreground">
        Tax you owe for the year with the standard deduction: 2026 IRS brackets (Rev. Proc. 2025-32), Social Security 6.2% up to $184,500, Medicare 1.45% (+0.9% over the
        threshold), NC 3.99%. Paychecks may withhold more than this during a short co-op term; the difference comes back as a refund. Not modeled: credits, itemizing, local tax.
      </p>
    </div>
  );
}

const scheduled = (i: Profile["incomes"][number]) => i.frequency === "weekly" || i.frequency === "biweekly" || (i.frequency === "hourly" && !!i.payEvery);
const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

/** One line's effect on this calendar year: paychecks, total, next expected paycheck. */
function IncomeEffect({ i, year }: { i: Profile["incomes"][number]; year: number }) {
  const label = i.basis === "gross" ? " before tax" : "";
  const months = Array.from({ length: 12 }, (_, k) => `${year}-${String(k + 1).padStart(2, "0")}`);
  const total = months.reduce((s, m) => s + incomeInMonth([i], m), 0);
  if (scheduled(i)) {
    if (!i.firstPayDate && !i.employmentStart) return <p className="text-[11px] text-amber-300">Enter the employment start or the first paycheck date.</p>;
    const checks = paychecks(i, `${year}-01-01`, `${year}-12-31`);
    const next = nextPaycheck([i], new Date().toISOString().slice(0, 10));
    const per = checks.at(-1)?.amount ?? checks[0]?.amount ?? 0;
    return (
      <p className="num text-[10px] text-muted-foreground">
        {year}: {checks.length} paycheck{checks.length === 1 ? "" : "s"} · {usd(total)}
        {label}
        {checks.length > 0 && <> · {usd(per)} per paycheck</>}
        {checks.length > 0 && <> · {checks[0]!.date} → {checks.at(-1)!.date}</>}
        {next && <b className="text-foreground"> · next expected {shortDate(next.date)}, {usd(next.amount)}</b>}
      </p>
    );
  }
  if (i.frequency === "once") {
    const paid = i.firstPayDate ?? null;
    if (!paid) return <p className="text-[11px] text-amber-300">Enter the date it&apos;s paid.</p>;
    return (
      <p className="num text-[10px] text-muted-foreground">
        {paid.startsWith(String(year)) ? <>{year}: {usd(total)}{label} in {paid.slice(0, 7)}</> : <>Paid {paid}: not in {year}</>}
      </p>
    );
  }
  if (!i.repeatsYearly && i.startMonth && i.endMonth && i.endMonth < i.startMonth) return <p className="text-[11px] text-down">Ends before it starts. Fix the dates.</p>;
  const active = months.filter((m) => incomeInMonth([i], m) > 0).length;
  return (
    <p className="num text-[10px] text-muted-foreground">
      {year}: {active} month{active === 1 ? "" : "s"} · {usd(total)}
      {label}
      {i.frequency === "hourly" && <> · {usd(monthlyEquivalent(i.amount, "hourly", i.hoursPerWeek))}/month at {i.hoursPerWeek ?? 40} h/week</>}
    </p>
  );
}

/** "IBM: $1,325.47 every Friday": proposals from payroll deposits. Nothing changes until you apply one and save. */
function PaycheckSuggestions({ p, set }: { p: Profile; set: Set }) {
  const q = useQuery({ queryKey: ["paychecks"], queryFn: () => api<PayPattern[]>("/api/finances/paychecks") });
  if (!q.data?.length) return null;
  const apply = (x: PayPattern, line: Profile["incomes"][number] | null) =>
    set((pr) => {
      const fields = { ...x.line, lastPayDate: x.ongoing ? (line?.lastPayDate ?? null) : x.last };
      const keep = line ? { name: line.name, kind: line.kind, employmentStart: line.employmentStart ?? null, employmentEnd: line.employmentEnd ?? null } : {};
      return line
        ? { ...pr, incomes: pr.incomes.map((i) => (i.id === line.id ? { ...i, ...fields, ...keep, hoursPerWeek: undefined, payEvery: undefined, repeatsYearly: false } : i)) }
        : { ...pr, incomes: [...pr.incomes, { id: uid(), ...fields }] };
    });
  return (
    <div className="mb-2 rounded-md border border-border bg-background/40 p-2 text-[11px]">
      <div className="mb-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Payroll deposits found</div>
      <ul className="space-y-0.5">
        {q.data.map((x) => {
          const line = matchIncomeLine(x, p.incomes);
          const same = line && lineMatchesPattern(line, x);
          const every = x.frequency === "weekly" ? `every ${WEEKDAYS[x.payDay!]}` : x.frequency === "biweekly" ? `every other ${WEEKDAYS[x.payDay!]}` : x.frequency === "semimonthly" ? "twice a month" : "monthly";
          return (
            <li key={x.employer} className="num flex flex-wrap items-center gap-x-2">
              <span className="font-sans font-medium">{x.employer}</span>
              <span>
                {usd(x.amount)} {every} · {x.count} deposits {x.first} → {x.last}
                {x.ongoing ? "" : " (ended)"}
              </span>
              {same ? (
                <span className="text-up">matches “{line.name}”</span>
              ) : (
                <button type="button" className="text-series-1 hover:underline" onClick={() => apply(x, line)}>
                  {line ? `apply to “${line.name}”` : "add line"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Second row for scheduled pay: employment dates, payday, first/last paycheck, and for hourly: workdays and pay period. */
function ScheduleRow({ i, upd }: { i: Profile["incomes"][number]; upd: (id: string, patch: Partial<Profile["incomes"][number]>) => void }) {
  const date = (label: string, key: "employmentStart" | "employmentEnd" | "firstPayDate" | "lastPayDate") => (
    <input aria-label={label} type="date" className={inp} value={i[key] ?? ""} onChange={(e) => upd(i.id, { [key]: e.target.value || null })} />
  );
  const days = i.workdays?.length ? i.workdays : [1, 2, 3, 4, 5];
  return (
    <div className="flex flex-wrap items-center gap-2 pl-1 text-[11px] text-muted-foreground">
      <span>employed</span>
      {date("Employment start", "employmentStart")}
      <span>to</span>
      {date("Employment end", "employmentEnd")}
      <span>· payday</span>
      <select aria-label="Payday" className={inp} value={i.payDay ?? 5} onChange={(e) => upd(i.id, { payDay: Number(e.target.value) })}>
        {WEEKDAYS.map((d, k) => (
          <option key={d} value={k}>
            {d}
          </option>
        ))}
      </select>
      <span>· first paycheck</span>
      {date("First paycheck", "firstPayDate")}
      <span>last</span>
      {date("Last paycheck", "lastPayDate")}
      {i.frequency === "hourly" && (
        <>
          <span>· workdays</span>
          <span className="flex gap-0.5" role="group" aria-label="Workdays">
            {DAY_LETTERS.map((l, k) => (
              <button
                key={k}
                type="button"
                aria-pressed={days.includes(k)}
                aria-label={WEEKDAYS[k]}
                onClick={() => upd(i.id, { workdays: days.includes(k) ? days.filter((d) => d !== k) : [...days, k].sort() })}
                className={cn("size-5 rounded border text-[10px]", days.includes(k) ? "border-series-1 bg-series-1/15 text-foreground" : "border-border")}
              >
                {l}
              </button>
            ))}
          </span>
          <span>· period ends</span>
          <Num label="Pay period ends days before payday" value={i.periodEndsDaysBefore ?? 0} onChange={(n) => upd(i.id, { periodEndsDaysBefore: Math.max(0, Math.round(n)) })} className="w-12" />
          <span>days before payday</span>
        </>
      )}
    </div>
  );
}

export function IncomeSection({ p, set }: { p: Profile; set: Set }) {
  const upd = (id: string, patch: Partial<Profile["incomes"][number]>) => set((x) => ({ ...x, incomes: x.incomes.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
  const year = Number(ymOf(useNow(60 * 60_000)).slice(0, 4));
  const net = netIncome(p, `${year}-01`, 12);
  const yearTotal = net.byMonth.reduce((s, m) => s + m.amount, 0);
  return (
    <Section
      title="Income"
      hint={
        p.country === "US"
          ? "Take-home or before tax (the app estimates US federal, FICA and state tax). Weekly and every-2-weeks pay counts each payday."
          : "Take-home pay. Weekly and every-2-weeks pay counts each payday."
      }
      onAdd={() =>
        set((x) => ({
          ...x,
          incomes: [...x.incomes, { id: uid(), name: "Job", amount: 0, frequency: "weekly", kind: "salary", basis: "net", payDay: 5, employmentStart: null, firstPayDate: null }],
        }))
      }
    >
      <PaycheckSuggestions p={p} set={set} />
      {p.incomes.length === 0 && <p className="text-[11px] text-muted-foreground">No income yet.</p>}
      <div className="space-y-2">
        {p.incomes.map((i) => (
          <div key={i.id} className="space-y-0.5">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <input aria-label="Income name" className={cn(inp, "w-36")} value={i.name} onChange={(e) => upd(i.id, { name: e.target.value })} />
              <span className="text-muted-foreground">$</span>
              <Num label="Amount" value={i.amount} step={i.frequency === "hourly" ? 0.25 : 1} onChange={(n) => upd(i.id, { amount: n })} className="w-24" />
              <select aria-label="Pay basis" className={inp} value={i.basis ?? "net"} onChange={(e) => upd(i.id, { basis: e.target.value as "net" | "gross" })}>
                <option value="gross" disabled={p.country !== "US"}>
                  before tax{p.country !== "US" ? " (US only)" : ""}
                </option>
                <option value="net">take-home</option>
              </select>
              <select
                aria-label="Frequency"
                className={inp}
                value={i.frequency}
                onChange={(e) => {
                  const f = e.target.value as typeof i.frequency;
                  upd(i.id, {
                    frequency: f,
                    ...(f === "hourly" && !i.hoursPerWeek ? { hoursPerWeek: 40, payEvery: "weekly" as const } : {}),
                    ...((f === "weekly" || f === "biweekly") && i.payDay === undefined ? { payDay: 5 } : {}),
                    ...(f === "once" ? { kind: "bonus" as const } : {}),
                  });
                }}
              >
                <option value="weekly">per paycheck, weekly</option>
                <option value="biweekly">per paycheck, every 2 weeks</option>
                <option value="hourly">per hour</option>
                <option value="semimonthly">twice a month</option>
                <option value="monthly">monthly</option>
                <option value="annual">yearly</option>
                <option value="once">once (bonus)</option>
              </select>
              {i.frequency === "hourly" && (
                <>
                  <label className="flex items-center gap-1 text-muted-foreground">
                    × <Num label="Hours per week" value={i.hoursPerWeek ?? 40} onChange={(n) => upd(i.id, { hoursPerWeek: n })} className="w-14" /> h/week
                  </label>
                  <select aria-label="Paid how often" className={inp} value={i.payEvery ?? ""} onChange={(e) => upd(i.id, { payEvery: (e.target.value || undefined) as "weekly" | "biweekly" | undefined })}>
                    <option value="weekly">paid weekly</option>
                    <option value="biweekly">paid every 2 weeks</option>
                    <option value="">monthly estimate</option>
                  </select>
                </>
              )}
              <select aria-label="Kind" className={inp} value={i.kind} onChange={(e) => upd(i.id, { kind: e.target.value as typeof i.kind })}>
                <option value="salary">job</option>
                <option value="coop">co-op term</option>
                <option value="bonus">bonus</option>
                <option value="other">other</option>
              </select>
              {i.frequency === "once" && (
                <>
                  <span className="text-muted-foreground">paid on</span>
                  <input aria-label="Paid on" type="date" className={inp} value={i.firstPayDate ?? ""} onChange={(e) => upd(i.id, { firstPayDate: e.target.value || null, startMonth: e.target.value ? e.target.value.slice(0, 7) : null })} />
                </>
              )}
              {!scheduled(i) && i.frequency !== "once" && (
                <>
                  <span className="text-muted-foreground">from</span>
                  <input aria-label="Start month" type="month" className={inp} value={i.startMonth ?? ""} onChange={(e) => upd(i.id, { startMonth: e.target.value || null })} />
                  <span className="text-muted-foreground">to</span>
                  <input aria-label="End month" type="month" className={inp} value={i.endMonth ?? ""} onChange={(e) => upd(i.id, { endMonth: e.target.value || null })} />
                </>
              )}
              <Del label="Remove income" onClick={() => set((x) => ({ ...x, incomes: x.incomes.filter((y) => y.id !== i.id) }))} />
            </div>
            {scheduled(i) && <ScheduleRow i={i} upd={upd} />}
            <IncomeEffect i={i} year={year} />
          </div>
        ))}
      </div>
      {net.taxes.length > 0 && <TaxBreakdown taxes={net.taxes} />}
      {net.notes.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-[10px] text-amber-300">
          {net.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {p.incomes.length > 0 && (
        <p className="num mt-2 text-[11px]">
          {year} take-home (Jan–Dec): <b>{usd(yearTotal)}</b>
        </p>
      )}
    </Section>
  );
}

/** Budget-line category: a fixed list, the same one transactions use. An older free-text name stays selectable until you pick a standard one. */
function CategoryPicker({ value, onChange }: { value: string; onChange: (v: string, kind: "need" | "want") => void }) {
  const custom = !SPENDING_CATEGORY_NAMES.includes(value);
  const suggestion = custom ? SPENDING_CATEGORY_NAMES.find((c) => matchPlanCategory(c, [value]) === value) : undefined;
  return (
    <>
      <select aria-label="Category" className={cn(inp, "w-40", custom && "border-amber-500/60")} value={value} onChange={(ev) => onChange(ev.target.value, defaultKind(ev.target.value))}>
        {custom && <option value={value}>{value} (old name)</option>}
        {SPENDING_CATEGORIES.map((c) => (
          <option key={c.name} value={c.name}>
            {c.name}
          </option>
        ))}
      </select>
      {custom && (
        <button type="button" className="text-[10px] text-amber-300 hover:underline" onClick={() => suggestion && onChange(suggestion, defaultKind(suggestion))} disabled={!suggestion} title="Pick a category from the list so this line matches your transactions">
          {suggestion ? `use ${suggestion}?` : "pick a category"}
        </button>
      )}
    </>
  );
}

/** "actual ~$502/mo · use": your real average next to a budget line that's current, when they differ by more than 10%. */
function ActualHint({ avg, line, now, onUse }: { avg: number | null; line: Profile["expenses"][number]; now: string; onUse: (n: number) => void }) {
  const current = isActive(line, now) || (!!line.endMonth && line.endMonth >= now);
  if (avg === null || !current || Math.abs(avg - line.monthly) <= Math.max(10, line.monthly * 0.1)) return null;
  return (
    <button type="button" className="text-[10px] text-series-1 hover:underline" title="Your average from imported transactions (full months this year)" onClick={() => onUse(Math.round(avg))}>
      actual ~${Math.round(avg)}/mo · use
    </button>
  );
}

export function ExpenseSection({ p, set }: { p: Profile; set: Set }) {
  const upd = (id: string, patch: Partial<Profile["expenses"][number]>) => set((x) => ({ ...x, expenses: x.expenses.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
  // Your real monthly average per category (full months this year), to suggest budget amounts.
  const year = new Date().getFullYear();
  const actual = useQuery({ queryKey: ["summary", year], queryFn: () => api<{ summary: YearSummary | null }>(`/api/finances/summary?year=${year}`) });
  const avgOf = (cat: string) => actual.data?.summary?.categories.find((c) => c.category === cat)?.avgPerMonth ?? null;
  const now = ymOf(useNow(60 * 60_000));
  const missing = SPENDING_CATEGORIES.filter((c) => !p.expenses.some((e) => e.category === c.name) && (c.name !== "Other" || (avgOf("Other") ?? 0) > 0)).sort(
    (a, b) => (avgOf(b.name) ?? 0) - (avgOf(a.name) ?? 0),
  );
  return (
    <Section
      title="Monthly spending"
      hint="Categories come from one fixed list, the same one your transactions use, so each line lines up with its spending. Needs = must pay; wants = could cut. Leave the dates blank for every month. When an amount changes (a new lease, cheaper summer groceries), give each period its own line with the same category and its own dates; “+ next period” does that. Your real spending is under Analysis."
      onAdd={() => set((x) => ({ ...x, expenses: [...x.expenses, { id: uid(), category: "Other", monthly: 0, kind: "want" }] }))}
    >
      <div className="space-y-1.5">
        {p.expenses.map((e) => (
          <div key={e.id} className="flex flex-wrap items-center gap-2 text-xs">
            <CategoryPicker value={e.category} onChange={(category, kind) => upd(e.id, { category, kind })} />
            <Num label="Monthly amount" value={e.monthly} onChange={(n) => upd(e.id, { monthly: n })} />
            <ActualHint avg={avgOf(e.category)} line={e} now={now} onUse={(n) => upd(e.id, { monthly: n })} />
            <select aria-label="Need or want" className={inp} value={e.kind} onChange={(ev) => upd(e.id, { kind: ev.target.value as "need" | "want" })}>
              <option value="need">need</option>
              <option value="want">want</option>
            </select>
            <span className="text-muted-foreground">from</span>
            <input aria-label="Expense start month" type="month" className={inp} value={e.startMonth ?? ""} onChange={(ev) => upd(e.id, { startMonth: ev.target.value || null })} />
            <span className="text-muted-foreground">to</span>
            <input aria-label="Expense end month" type="month" className={inp} value={e.endMonth ?? ""} onChange={(ev) => upd(e.id, { endMonth: ev.target.value || null })} />
            <label className="flex items-center gap-1 text-muted-foreground" title="Same months every year, e.g. higher heating Dec–Feb">
              <input type="checkbox" checked={e.repeatsYearly ?? false} disabled={!e.startMonth || !e.endMonth} onChange={(ev) => upd(e.id, { repeatsYearly: ev.target.checked })} />
              every year
            </label>
            <button
              type="button"
              className="text-[10px] text-series-1 hover:underline"
              title="Add another line for the same category, starting after this one ends (e.g. the next lease)"
              onClick={() =>
                set((x) => {
                  const start = e.endMonth ? addMonths(e.endMonth, 1) : null;
                  const at = x.expenses.findIndex((y) => y.id === e.id);
                  const next = { id: uid(), category: e.category, monthly: e.monthly, kind: e.kind, startMonth: start, endMonth: null };
                  return { ...x, expenses: [...x.expenses.slice(0, at + 1), next, ...x.expenses.slice(at + 1)] };
                })
              }
            >
              + next period
            </button>
            <Del label="Remove expense" onClick={() => set((x) => ({ ...x, expenses: x.expenses.filter((y) => y.id !== e.id) }))} />
            {!e.repeatsYearly && e.startMonth && e.endMonth && e.endMonth < e.startMonth && <span className="text-down">ends before it starts</span>}
          </div>
        ))}
      </div>
      {missing.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {missing.map(({ name: c, kind: k }) => (
            <button
              key={c}
              type="button"
              onClick={() => set((x) => ({ ...x, expenses: [...x.expenses, { id: uid(), category: c, monthly: Math.round(avgOf(c) ?? 0), kind: k }] }))}
              className={cn(
                "rounded border border-dashed px-1.5 py-0.5 text-[10px] hover:text-foreground",
                (avgOf(c) ?? 0) > 0 ? "border-amber-500/50 text-amber-300" : "border-border text-muted-foreground",
              )}
              title={(avgOf(c) ?? 0) > 0 ? "You spend on this but have no budget line: adds one at your actual monthly average" : undefined}
            >
              + {c}
              {(avgOf(c) ?? 0) > 0 && ` (~$${Math.round(avgOf(c)!)}/mo actual)`}
            </button>
          ))}
        </div>
      )}
    </Section>
  );
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const cell = "num h-6 w-[4.25rem] rounded border border-transparent bg-transparent px-1 text-right text-[11px] outline-none hover:border-input focus:border-ring focus:bg-background";
const whole0 = (x: number) => `$${Math.round(x).toLocaleString("en-US")}`;

/** One editable month cell; "→" copies it into every later month (a rent change from May on). */
function MonthCell({ value, onChange, onFill, label }: { value: number; onChange: (n: number) => void; onFill?: () => void; label: string }) {
  return (
    <td className="group relative p-0">
      <input aria-label={label} type="number" min={0} step={1} className={cell} value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange(Number(e.target.value) || 0)} />
      {onFill && (
        <button
          type="button"
          tabIndex={-1}
          title="Copy to the rest of the year"
          aria-label={`${label}: copy to the rest of the year`}
          onClick={onFill}
          className="absolute top-0.5 right-0 hidden rounded px-0.5 text-[9px] text-series-1 group-focus-within:block group-hover:block"
        >
          →
        </button>
      )}
    </td>
  );
}

/**
 * The calendar-year budget and savings plan: per category a Jan–Dec allocation
 * (the annual budget is the sum), plus cash to save and money to invest each month.
 * This is the plan; statements are compared against it under My plan and never change it.
 */
export function YearBudgetSection({ p, set }: { p: Profile; set: Set }) {
  const year = Number(ymOf(useNow(60 * 60_000)).slice(0, 4));
  const plan = p.yearPlans?.[String(year)] ?? newYearPlan(p, year, new Date().toISOString().slice(0, 10));
  const setPlan = (fn: (pl: YearPlan) => YearPlan) => set((x) => ({ ...x, yearPlans: { ...(x.yearPlans ?? {}), [String(year)]: fn(x.yearPlans?.[String(year)] ?? plan) } }));
  const setRow = (k: number, months: number[]) => setPlan((pl) => ({ ...pl, budget: pl.budget.map((r, j) => (j === k ? { ...r, months } : r)) }));
  const planned = plannedMonths(plan, p);
  const income = planned.map((m) => m.income);
  // Estimates from statements: the average of full months × 12 (an estimate, not actual annual spending).
  const actual = useQuery({ queryKey: ["summary", year], queryFn: () => api<{ summary: YearSummary | null }>(`/api/finances/summary?year=${year}`) });
  const s = actual.data?.summary;
  const range = s?.fullMonths.length ? `${MONTH_ABBR[Number(s.fullMonths[0]!.slice(5)) - 1]}–${MONTH_ABBR[Number(s.fullMonths.at(-1)!.slice(5)) - 1]}, ${s.fullMonths.length} full months` : "";
  const est = (cat: string) => {
    const a = s?.categories.find((c) => c.category === cat)?.avgPerMonth;
    return a ? { avg: Math.round(a), year: Math.round(a) * 12 } : null;
  };
  const missing = SPENDING_CATEGORIES.filter((c) => !plan.budget.some((r) => r.category === c.name)).sort((a, b) => (est(b.name)?.year ?? 0) - (est(a.name)?.year ?? 0));
  const spendTotal = planned.map((m) => m.spending);
  const unassigned = planned.map((m) => m.unassigned);
  const target = (key: "save" | "invest", label: string) => (
    <tr className="border-t border-border/50">
      <td className="py-0.5 pr-2 font-sans text-xs">{label}</td>
      {plan[key].map((v, k) => (
        <MonthCell
          key={k}
          label={`${label} ${MONTH_ABBR[k]}`}
          value={v}
          onChange={(n) => setPlan((pl) => ({ ...pl, [key]: pl[key].map((x, j) => (j === k ? n : x)) }))}
          onFill={k < 11 ? () => setPlan((pl) => ({ ...pl, [key]: fillFrom(pl[key], k) })) : undefined}
        />
      ))}
      <td className="p-0 pl-1">
        <input
          aria-label={`${label} December goal`}
          type="number"
          min={0}
          className={cn(cell, "w-20 font-medium")}
          value={sum(plan[key])}
          onChange={(e) => setPlan((pl) => ({ ...pl, [key]: spreadAnnual(Number(e.target.value) || 0) }))}
        />
      </td>
      <td />
    </tr>
  );
  return (
    <Section title={`${year} budget & savings plan`} hint="Plan once at the start of the year. Year column = annual total (edit it to spread evenly); → copies a month into the rest of the year.">
      <div className="overflow-x-auto">
        <table className="num w-full text-[11px]">
          <thead className="text-[10px] tracking-wider text-muted-foreground uppercase">
            <tr>
              <th className="py-1 pr-2 text-left font-medium">{year}</th>
              {MONTH_ABBR.map((m) => (
                <th key={m} className="px-1 text-right font-medium">
                  {m}
                </th>
              ))}
              <th className="pl-1 text-right font-medium">Year</th>
              <th className="pl-2 text-right font-medium" title="Average of full statement months × 12 (an estimate)">
                Statements est.
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="text-muted-foreground">
              <td className="py-0.5 pr-2 font-sans text-xs">Take-home (income lines)</td>
              {income.map((v, k) => (
                <td key={k} className="px-1 text-right">
                  {whole0(v)}
                </td>
              ))}
              <td className="pl-1 text-right">{whole0(sum(income))}</td>
              <td />
            </tr>
            {plan.budget.map((r, k) => {
              const e = est(r.category);
              return (
                <tr key={r.category} className="border-t border-border/50">
                  <td className="py-0.5 pr-2 font-sans text-xs whitespace-nowrap">
                    {r.category}
                    <button
                      type="button"
                      className="ml-1 text-[10px] text-muted-foreground hover:text-foreground"
                      title="Need = must pay; want = could cut"
                      onClick={() => setPlan((pl) => ({ ...pl, budget: pl.budget.map((x, j) => (j === k ? { ...x, kind: x.kind === "need" ? "want" : "need" } : x)) }))}
                    >
                      {r.kind}
                    </button>
                    <button type="button" className="ml-1 text-[10px] text-muted-foreground hover:text-down" aria-label={`Remove ${r.category}`} onClick={() => setPlan((pl) => ({ ...pl, budget: pl.budget.filter((_, j) => j !== k) }))}>
                      ×
                    </button>
                  </td>
                  {r.months.map((v, m) => (
                    <MonthCell
                      key={m}
                      label={`${r.category} ${MONTH_ABBR[m]}`}
                      value={v}
                      onChange={(n) => setRow(k, r.months.map((x, j) => (j === m ? n : x)))}
                      onFill={m < 11 ? () => setRow(k, fillFrom(r.months, m)) : undefined}
                    />
                  ))}
                  <td className="p-0 pl-1">
                    <input aria-label={`${r.category} annual budget`} type="number" min={0} className={cn(cell, "w-20 font-medium")} value={sum(r.months)} onChange={(e) => setRow(k, spreadAnnual(Number(e.target.value) || 0))} />
                  </td>
                  <td className="pl-2 text-right whitespace-nowrap text-muted-foreground">
                    {e ? (
                      <button type="button" className="hover:text-foreground" title={`Average ${whole0(e.avg)}/month over ${range} × 12. Click to use it for every month.`} onClick={() => setRow(k, Array.from({ length: 12 }, () => e.avg))}>
                        {whole0(e.avg)} × 12 = {whole0(e.year)}
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
            <tr className="border-t border-border font-medium">
              <td className="py-0.5 pr-2 font-sans text-xs">Spending</td>
              {spendTotal.map((v, k) => (
                <td key={k} className="px-1 text-right">
                  {whole0(v)}
                </td>
              ))}
              <td className="pl-1 text-right">{whole0(sum(spendTotal))}</td>
              <td />
            </tr>
            {target("save", "Save (cash)")}
            {target("invest", "Invest")}
            <tr className="border-t border-border">
              <td className="py-0.5 pr-2 font-sans text-xs text-muted-foreground">Unassigned</td>
              {unassigned.map((v, k) => (
                <td key={k} className={cn("px-1 text-right", v < 0 ? "text-down" : "text-muted-foreground")}>
                  {whole0(v)}
                </td>
              ))}
              <td className={cn("pl-1 text-right", sum(unassigned) < 0 ? "text-down" : "text-muted-foreground")}>{whole0(sum(unassigned))}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      {missing.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {missing.map((c) => {
            const e = est(c.name);
            return (
              <button
                key={c.name}
                type="button"
                onClick={() => setPlan((pl) => addBudgetRow(pl, c.name, e?.avg ?? 0))}
                title={e ? `Adds ${whole0(e.avg)} every month: your average over ${range} × 12 = ${whole0(e.year)} (an estimate)` : undefined}
                className={cn("rounded border border-dashed px-1.5 py-0.5 text-[10px] hover:text-foreground", e ? "border-amber-500/50 text-amber-300" : "border-border text-muted-foreground")}
              >
                + {c.name}
                {e && ` · est. ${whole0(e.year)}/yr`}
              </button>
            );
          })}
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
      <AutoRollControl p={p} set={set} />
    </Section>
  );
}

/** Turn on monthly automatic balance updates. */
function AutoRollControl({ p, set }: { p: Profile; set: Set }) {
  const cashAccounts = p.accounts.filter((a) => a.type === "CASH" || a.type === "HISA");
  const cs = p.cashSync;
  if (cashAccounts.length === 0) return null;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="mt-3 rounded border border-border p-2 text-xs">
      <label className="flex flex-wrap items-center gap-2">
        <input
          type="checkbox"
          checked={cs?.enabled ?? false}
          onChange={(e) =>
            set((x) => ({ ...x, cashSync: { enabled: e.target.checked, accountId: x.cashSync?.accountId ?? cashAccounts[0]!.id, balanceAsOf: x.cashSync?.balanceAsOf ?? today, credited: x.cashSync?.credited ?? [] } }))
          }
        />
        Add imported paycheck deposits to
        <select
          aria-label="Account for paycheck deposits"
          className={inp}
          value={cs?.accountId ?? cashAccounts[0]!.id}
          onChange={(e) => set((x) => ({ ...x, cashSync: { enabled: x.cashSync?.enabled ?? true, balanceAsOf: today, credited: x.cashSync?.credited ?? [], accountId: e.target.value } }))}
        >
          {cashAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      {cs?.enabled && (
        <p className="num mt-1 text-[10px] text-muted-foreground">
          Balance entered {cs.balanceAsOf}: deposits dated after it are added once each when you import a statement ({cs.credited.length} so far). Editing the balance resets the date.
        </p>
      )}
    </div>
  );
}

export function GoalSection({ p, set }: { p: Profile; set: Set }) {
  const upd = (id: string, patch: Partial<Profile["goals"][number]>) => set((x) => ({ ...x, goals: x.goals.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
  const nextYear = `${new Date().getFullYear() + 1}-12`;
  return (
    <Section
      title="Goals"
      hint="Targets in today's dollars. Priority 1 is funded first. Net-worth and long-term goals carry over every year and show under My plan."
      onAdd={() => set((x) => ({ ...x, goals: [...x.goals, { id: uid(), name: "New goal", kind: "other", target: 5000, targetDate: nextYear, priority: x.goals.length + 1, current: 0 }] }))}
      addLabel="Add goal"
    >
      {p.goals.length === 0 && <p className="text-[11px] text-muted-foreground">Add at least one goal, e.g. an emergency fund.</p>}
      <div className="space-y-1.5">
        {p.goals.map((g) => (
          <div key={g.id} className="flex flex-wrap items-center gap-2 text-xs">
            <input aria-label="Goal name" className={cn(inp, "w-40")} value={g.name} onChange={(e) => upd(g.id, { name: e.target.value })} />
            <select aria-label="Goal type" className={inp} value={g.kind} onChange={(e) => upd(g.id, { kind: e.target.value as typeof g.kind })}>
              {["emergency", "car", "house", "retirement", "long_term", "net_worth", "education", "other"].map((k) => (
                <option key={k} value={k}>
                  {k.replace("_", " ")}
                </option>
              ))}
            </select>
            <span className="text-muted-foreground">target</span>
            <Num label="Target amount" value={g.target} onChange={(n) => upd(g.id, { target: n })} />
            <span className="text-muted-foreground">by</span>
            <input aria-label="Target date" type="month" className={inp} value={g.targetDate} onChange={(e) => upd(g.id, { targetDate: e.target.value || nextYear })} />
            {g.kind === "net_worth" ? (
              <span className="text-[11px] text-muted-foreground">now = your accounts − debts + invested</span>
            ) : (
              <>
                <span className="text-muted-foreground">saved</span>
                <Num label="Already saved" value={g.current} onChange={(n) => upd(g.id, { current: n })} className="w-24" />
              </>
            )}
            {(g.kind === "retirement" || g.kind === "long_term" || g.kind === "house") && (
              <>
                <span className="text-muted-foreground">adding</span>
                <Num label="Monthly contribution" value={g.monthlyContribution ?? 0} onChange={(n) => upd(g.id, { monthlyContribution: n })} className="w-20" />
                <span className="text-muted-foreground">/mo</span>
              </>
            )}
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
        <label className="flex items-center gap-1.5" title="Share of long-term investing money you may use for individual stock picking in the Terminal (paper trading)">
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

export function TaxFactsSection({ p, set }: { p: Profile; set: Set }) {
  const t = p.tax ?? {};
  const upd = (patch: Partial<NonNullable<Profile["tax"]>>) => set((x) => ({ ...x, tax: { ...(x.tax ?? {}), ...patch } }));
  const year = Number(ymOf(useNow(60 * 60_000)).slice(0, 4));
  const derived = derivedTaxFacts(p, year);
  const hasStateRules = p.region.toUpperCase() in (TAX_YEARS[2026]?.states ?? {});
  return (
    <Section
      title="Tax facts (for account eligibility)"
      hint="Used only to check contribution limits for the mock accounts. Encrypted with the rest of your profile; never sent to the AI as exact numbers."
    >
      <div className="grid gap-2 text-xs @3xl:grid-cols-2">
        <div className="space-y-1.5 rounded border border-border p-2">
          <p className="font-medium">United States (Roth/Traditional IRA, 401(k), HSA)</p>
          {derived && (
            <p className="text-[10px] text-muted-foreground">
              Leave a field empty to use what&apos;s calculated from your before-tax income for {year}: earned income {usd(derived.earnedIncome)}, MAGI ≈ AGI {usd(derived.magi)},
              marginal rate {derived.marginalPct}%.
            </p>
          )}
          <label className="flex items-center justify-between gap-2">
            US earned income this year <OptNum label="US earned income" value={t.usEarnedIncome} placeholder={derived ? String(Math.round(derived.earnedIncome)) : ""} onChange={(v) => upd({ usEarnedIncome: v })} />
          </label>
          <label className="flex items-center justify-between gap-2">
            Filing status
            <select aria-label="Filing status" className={inp} value={t.filingStatus ?? "single"} onChange={(e) => upd({ filingStatus: e.target.value as "single" })}>
              <option value="single">single</option>
              <option value="hoh">head of household</option>
              <option value="mfj">married filing jointly</option>
              <option value="mfs">married filing separately</option>
            </select>
          </label>
          <label className="flex items-center justify-between gap-2">
            Estimated MAGI <OptNum label="MAGI" value={t.magi} placeholder={derived ? String(Math.round(derived.magi)) : ""} onChange={(v) => upd({ magi: v })} />
          </label>
          <label className="flex items-center justify-between gap-2" title="Traditional 401(k), health/dental premiums taken from pay before tax">
            Pre-tax payroll deductions / year <OptNum label="Pre-tax deductions" value={t.pretaxAnnual} placeholder="0" onChange={(v) => upd({ pretaxAnnual: v })} />
          </label>
          {!hasStateRules && (
            <label className="flex items-center justify-between gap-2" title={`No verified tax rules for ${p.region || "your state"} yet`}>
              State income-tax estimate for {p.region || "your state"} (%)
              <OptNum label="State tax rate" value={t.stateRatePct ?? undefined} placeholder="0" onChange={(v) => upd({ stateRatePct: v ?? null })} />
            </label>
          )}
          <label className="flex items-center justify-between gap-2">
            HDHP coverage (for HSA)
            <select aria-label="HSA coverage" className={inp} value={t.hsaCoverage ?? "none"} onChange={(e) => upd({ hsaCoverage: e.target.value as "none" })}>
              <option value="none">none</option>
              <option value="self">self-only</option>
              <option value="family">family</option>
            </select>
          </label>
        </div>
        <div className="space-y-1.5 rounded border border-border p-2">
          <p className="font-medium">Canada (TFSA, RRSP, FHSA)</p>
          <label className="flex items-center justify-between gap-2">
            Last year&apos;s earned income <Num label="Canadian earned income last year" value={t.caPrevYearEarnedIncome ?? 0} onChange={(n) => upd({ caPrevYearEarnedIncome: n })} />
          </label>
          <label className="flex items-center justify-between gap-2">
            Unused RRSP room (notice of assessment) <Num label="Unused RRSP room" value={t.rrspUnusedRoom ?? 0} onChange={(n) => upd({ rrspUnusedRoom: n })} />
          </label>
          <label className="flex items-center justify-between gap-2">
            TFSA room from CRA My Account (optional)
            <input
              aria-label="TFSA room from CRA"
              type="number"
              min={0}
              className={numInp}
              placeholder="auto"
              value={t.tfsaRoomOverride ?? ""}
              onChange={(e) => upd({ tfsaRoomOverride: e.target.value === "" ? null : Number(e.target.value) })}
            />
          </label>
          <label className="flex items-center justify-between gap-2">
            Birth year <Num label="Birth year" value={t.birthYear ?? new Date().getFullYear() - p.age} onChange={(n) => upd({ birthYear: Math.round(n) })} className="w-20" />
          </label>
        </div>
        <label className="flex items-center gap-2">
          Marginal income-tax rate, federal + state combined{" "}
          <OptNum label="Marginal tax rate" value={t.marginalTaxPct} placeholder={derived ? String(derived.marginalPct) : "22"} onChange={(v) => upd({ marginalTaxPct: v })} />%
          <span className="text-[10px] text-muted-foreground">used to estimate tax on non-qualified withdrawals</span>
        </label>
      </div>
    </Section>
  );
}
