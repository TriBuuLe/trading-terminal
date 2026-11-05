"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { dateOnly, money, pct, qty as fmtQty } from "@/lib/format";
import type { Profile } from "@/lib/planner/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Change, EmptyState, ErrorState, LoadingRows, Tag } from "../terminal/bits";

type MockType = "ROTH_IRA" | "TRADITIONAL_IRA" | "401K" | "HSA" | "TFSA" | "RRSP" | "FHSA" | "TAXABLE";
interface Holding {
  symbol: string;
  qty: string;
  price: number | null;
  value: number | null;
  costBasis: number;
}
interface Acct {
  id: number;
  type: MockType;
  name: string;
  openedAt: string;
  firstContributionTaxYear: number | null;
  cash: number;
  holdings: Holding[];
  value: number | null;
  contributionsByTaxYear: Record<string, number>;
  contributionBasis: number;
  netDeposits: number;
  gain: number | null;
  missingPrices: string[];
}
interface Schedule {
  id: number;
  accountId: number;
  amount: string;
  dayOfMonth: number;
  active: boolean;
  lastRunMonth: string | null;
}
interface AccountsResponse {
  accounts: Acct[];
  schedules: Schedule[];
  rules: { year: number; lastVerified: string; missing: string[] };
  location: {
    target: Record<string, number>;
    perAccount: { accountId: string; type: string; treatment: string; balance: number; holdings: Record<string, number> }[];
    combined: Record<string, number>;
    reasons: Record<string, string>;
  };
}
interface Preview {
  ok: boolean;
  allowed: number;
  room: number | null;
  excess: number;
  penalty: string | null;
  messages: string[];
  taxYearsOpen: number[];
  needsInfo: string[];
}

const LABEL: Record<MockType, string> = {
  ROTH_IRA: "Roth IRA",
  TRADITIONAL_IRA: "Traditional IRA",
  "401K": "401(k)",
  HSA: "HSA",
  TFSA: "TFSA",
  RRSP: "RRSP",
  FHSA: "FHSA",
  TAXABLE: "Taxable",
};
const CLASS_LABEL: Record<string, string> = { us_equity: "US stocks (VTI)", intl_equity: "Intl stocks (VXUS)", bonds: "Bonds (BND)", reit: "REITs (VNQ)", cash: "Cash (SGOV)" };
const inp = "h-7 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-ring";

function useRefresh() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: ["mock-accounts"] }), qc.invalidateQueries({ queryKey: ["mock-history"] }), qc.invalidateQueries({ queryKey: ["mock-overview"] })]);
}

function Contribute({ acct }: { acct: Acct }) {
  const [amount, setAmount] = useState("");
  const [taxYear, setTaxYear] = useState<number | undefined>();
  const [acceptExcess, setAcceptExcess] = useState(false);
  const refresh = useRefresh();
  const n = Number(amount);
  const pv = useQuery({
    queryKey: ["contrib-preview", acct.id, n, taxYear],
    queryFn: () => api<Preview>(`/api/accounts/${acct.id}/contribute-preview`, { method: "POST", body: { amount: n, taxYear } }),
    enabled: n > 0,
  });
  const go = useMutation({
    mutationFn: (mode: "cash" | "fund") =>
      api(`/api/accounts/${acct.id}/${mode === "fund" ? "fund" : "contribute"}`, { method: "POST", body: { amount: n, taxYear, acceptExcess } }),
    onSuccess: async (_r, mode) => {
      toast.success(mode === "fund" ? "Contributed and invested per your target allocation" : "Contribution recorded");
      setAmount("");
      await refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const fund = useQuery({
    queryKey: ["fund-preview", acct.id, n],
    queryFn: () => api<{ buys: { symbol: string; qty: number; dollars: number; price: number }[]; leftover: number }>(`/api/accounts/${acct.id}/fund-preview`, { method: "POST", body: { amount: n } }),
    enabled: n > 0 && !!pv.data && pv.data.ok,
  });
  const p = pv.data;
  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Contribution amount" className={cn(inp, "num w-28")} inputMode="decimal" placeholder="amount" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
        {p && p.taxYearsOpen.length > 1 && (
          <select aria-label="Tax year" className={inp} value={taxYear ?? p.taxYearsOpen.at(-1)} onChange={(e) => setTaxYear(Number(e.target.value))}>
            {p.taxYearsOpen.map((y) => (
              <option key={y} value={y}>
                for tax year {y}
              </option>
            ))}
          </select>
        )}
        {p?.room !== null && p?.room !== undefined && <span className="text-muted-foreground">room: {money(p.room)}</span>}
      </div>
      {p && (
        <div className={cn("rounded p-2 text-[11px]", p.needsInfo.length ? "bg-amber-500/10 text-amber-300" : p.excess > 0 ? "bg-down-muted text-down" : "bg-up-muted")}>
          {p.needsInfo.length > 0 && <p>Add to Tax facts first: {p.needsInfo.join(", ")}.</p>}
          {p.messages.map((m) => (
            <p key={m}>{m}</p>
          ))}
          {p.excess > 0 && (
            <label className="mt-1 flex items-center gap-1.5 font-medium">
              <input type="checkbox" checked={acceptExcess} onChange={(e) => setAcceptExcess(e.target.checked)} /> I understand {money(p.excess)} would be an excess contribution ({p.penalty}).
            </label>
          )}
        </div>
      )}
      {fund.data && fund.data.buys.length > 0 && (
        <div className="rounded border border-border p-2 text-[11px]">
          <p className="mb-1 font-medium">“Fund my {LABEL[acct.type]}” would buy (live prices incl. slippage):</p>
          {fund.data.buys.map((b) => (
            <p key={b.symbol} className="num">
              {fmtQty(b.qty)} {b.symbol} @ {b.price.toFixed(2)} = {money(b.dollars)}
            </p>
          ))}
          <p className="text-muted-foreground">cash left: {money(fund.data.leftover)}</p>
        </div>
      )}
      <div className="flex gap-2">
        <Button size="sm" disabled={!p || p.needsInfo.length > 0 || (p.excess > 0 && !acceptExcess) || go.isPending} onClick={() => go.mutate("fund")}>
          Contribute &amp; invest (fund my {LABEL[acct.type]})
        </Button>
        <Button size="sm" variant="outline" disabled={!p || p.needsInfo.length > 0 || (p.excess > 0 && !acceptExcess) || go.isPending} onClick={() => go.mutate("cash")}>
          Contribute as cash
        </Button>
      </div>
    </div>
  );
}

function Withdraw({ acct }: { acct: Acct }) {
  const [amount, setAmount] = useState("");
  const n = Number(amount);
  const refresh = useRefresh();
  const pv = useQuery({
    queryKey: ["withdraw-preview", acct.id, n],
    queryFn: () => api<{ cashAvailable: number; explanation: string[]; cost: number | null }>(`/api/accounts/${acct.id}/withdraw-preview`, { method: "POST", body: { amount: n } }),
    enabled: n > 0,
  });
  const go = useMutation({
    mutationFn: () => api(`/api/accounts/${acct.id}/withdraw`, { method: "POST", body: { amount: n } }),
    onSuccess: async () => (toast.success("Withdrawal recorded"), setAmount(""), refresh()),
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="space-y-2 text-xs">
      <input aria-label="Withdrawal amount" className={cn(inp, "num w-28")} placeholder="amount" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
      {pv.data && (
        <div className="rounded bg-muted/50 p-2 text-[11px]">
          {pv.data.explanation.map((m) => (
            <p key={m}>{m}</p>
          ))}
          {pv.data.cost !== null && pv.data.cost > 0 && <p className="font-medium text-down">Estimated tax + penalty: {money(pv.data.cost)}</p>}
          {n > pv.data.cashAvailable && <p className="text-amber-300">Only {money(pv.data.cashAvailable)} is in cash: sell holdings first.</p>}
        </div>
      )}
      <Button size="sm" variant="outline" disabled={!(n > 0) || go.isPending || (pv.data ? n > pv.data.cashAvailable : true)} onClick={() => go.mutate()}>
        Withdraw
      </Button>
    </div>
  );
}

function Trade({ acct }: { acct: Acct }) {
  const [symbol, setSymbol] = useState("VTI");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [q, setQ] = useState("");
  const refresh = useRefresh();
  const go = useMutation({
    mutationFn: () => api<{ fill: number; cost: number }>(`/api/accounts/${acct.id}/trade`, { method: "POST", body: { symbol, side, qty: Number(q) } }),
    onSuccess: async (r) => (toast.success(`${side} ${q} ${symbol} @ ${r.fill.toFixed(2)} (${money(r.cost)})`), setQ(""), refresh()),
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <select aria-label="Side" className={inp} value={side} onChange={(e) => setSide(e.target.value as "buy")}>
        <option value="buy">buy</option>
        <option value="sell">sell</option>
      </select>
      <input aria-label="Quantity" className={cn(inp, "num w-20")} placeholder="shares" value={q} onChange={(e) => setQ(e.target.value.replace(/[^0-9.]/g, ""))} />
      <input aria-label="Symbol" className={cn(inp, "w-20 font-mono uppercase")} value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
      <Button size="sm" variant="outline" disabled={!(Number(q) > 0) || go.isPending} onClick={() => go.mutate()}>
        Place at live quote
      </Button>
      <span className="text-[10px] text-muted-foreground">Fills at the real IEX quote ± your slippage setting. Cash: {money(acct.cash)}</span>
    </div>
  );
}

function Schedules({ acct, schedules }: { acct: Acct; schedules: Schedule[] }) {
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState("1");
  const refresh = useRefresh();
  const mine = schedules.filter((s) => s.accountId === acct.id);
  const act = (path: string, method: string, body?: unknown) =>
    api(path, { method, body })
      .then(refresh)
      .catch((e: Error) => toast.error(e.message));
  return (
    <div className="space-y-1.5 text-xs">
      {mine.map((s) => (
        <div key={s.id} className="flex items-center gap-2">
          <span className="num">{money(s.amount)}</span> on day {s.dayOfMonth} of each month
          <span className="text-[10px] text-muted-foreground">{s.lastRunMonth ? `last run ${s.lastRunMonth}` : "not run yet"}</span>
          <label className="ml-auto flex items-center gap-1">
            <input type="checkbox" checked={s.active} onChange={(e) => void act(`/api/accounts/schedules/${s.id}`, "PATCH", { active: e.target.checked })} /> active
          </label>
          <button aria-label="Delete schedule" className="rounded p-1 hover:bg-secondary" onClick={() => void act(`/api/accounts/schedules/${s.id}`, "DELETE")}>
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <input aria-label="Monthly amount" className={cn(inp, "num w-24")} placeholder="monthly $" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
        on day
        <input aria-label="Day of month" type="number" min={1} max={28} className={cn(inp, "num w-14")} value={day} onChange={(e) => setDay(e.target.value)} />
        <Button size="sm" variant="outline" disabled={!(Number(amount) > 0)} onClick={() => void act(`/api/accounts/${acct.id}/schedule`, "POST", { amount: Number(amount), dayOfMonth: Number(day) }).then(() => setAmount(""))}>
          Add auto-contribution
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground">The daily job contributes on that day (up to your remaining room) and invests per the target allocation: a simulation of actually following the plan.</p>
    </div>
  );
}

function History({ acct }: { acct: Acct }) {
  const q = useQuery({
    queryKey: ["mock-history", acct.id],
    queryFn: () => api<{ points: { date: string; value: number; deposits: number; spy: number }[]; gain: number; gainVsSpy: number }>(`/api/accounts/${acct.id}/history`),
  });
  if (q.isPending) return <LoadingRows rows={3} className="p-0" />;
  if (q.isError) return <ErrorState error={q.error} compact />;
  const d = q.data;
  return (
    <div>
      <p className="mb-1 text-[11px]">
        Gain on deposits: <Change value={d.gain} /> · vs the same deposits into SPY: <Change value={d.gainVsSpy} />
      </p>
      {d.points.length < 2 ? (
        <p className="text-[11px] text-muted-foreground">The chart fills in as days pass (one point per trading day).</p>
      ) : (
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={d.points} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid stroke="#1f2125" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: "#8b8d93", fontSize: 10 }} tickLine={false} minTickGap={30} />
              <YAxis tick={{ fill: "#8b8d93", fontSize: 10 }} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => money(v, { whole: true })} />
              <Tooltip contentStyle={{ background: "#1c1d21", border: "1px solid #2a2c31", borderRadius: 6, fontSize: 11 }} formatter={(v, n) => [money(Number(v)), n === "value" ? "This account" : n === "spy" ? "Same deposits in SPY" : "Deposits"]} />
              <Line dataKey="value" stroke="#3987e5" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line dataKey="spy" stroke="#d95926" strokeWidth={2} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
              <Line dataKey="deposits" stroke="#5b5e66" strokeWidth={1} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function Projection({ acct, profile }: { acct: Acct; profile: Profile }) {
  const [monthly, setMonthly] = useState(250);
  const [retireAge, setRetireAge] = useState(65);
  const [divTax, setDivTax] = useState(acct.type === "TFSA" || acct.type === "RRSP" ? 25 : 15);
  const [cgTax, setCgTax] = useState(15);
  const q = useQuery({
    queryKey: ["projection", acct.id, monthly, retireAge, divTax, cgTax],
    queryFn: () =>
      api<{ years: number; contributed: number; taxFreeP50: number; taxableP50AfterTax: number; wrapperWorth: number }>(
        `/api/accounts/${acct.id}/projection?monthly=${monthly}&retireAge=${retireAge}&divTax=${divTax}&cgTax=${cgTax}`,
      ),
  });
  const n = "h-6 w-16 rounded border border-input bg-background px-1 text-right text-[11px] num";
  return (
    <div className="space-y-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <label className="flex items-center gap-1">
          $/month <input aria-label="Monthly contribution" type="number" className={n} value={monthly} onChange={(e) => setMonthly(Number(e.target.value) || 0)} />
        </label>
        <label className="flex items-center gap-1">
          until age <input aria-label="Retirement age" type="number" className={n} value={retireAge} onChange={(e) => setRetireAge(Number(e.target.value) || 65)} />
        </label>
        <span className="text-muted-foreground">taxable-account comparison, your estimates:</span>
        <label className="flex items-center gap-1">
          dividend tax % <input aria-label="Dividend tax" type="number" className={n} value={divTax} onChange={(e) => setDivTax(Number(e.target.value) || 0)} />
        </label>
        <label className="flex items-center gap-1">
          capital-gains tax % <input aria-label="Capital gains tax" type="number" className={n} value={cgTax} onChange={(e) => setCgTax(Number(e.target.value) || 0)} />
        </label>
      </div>
      {q.data && (
        <p>
          Median in {q.data.years} years (today&apos;s $, {profile.age} → {retireAge}): <b className="num">{money(q.data.taxFreeP50, { whole: true })}</b> tax-free vs{" "}
          <span className="num">{money(q.data.taxableP50AfterTax, { whole: true })}</span> in a taxable account after tax: the wrapper is worth about{" "}
          <b className="num text-up">{money(q.data.wrapperWorth, { whole: true })}</b> to you. You&apos;d contribute {money(q.data.contributed, { whole: true })}.
        </p>
      )}
    </div>
  );
}

function AccountCard({ acct, schedules, profile }: { acct: Acct; schedules: Schedule[]; profile: Profile }) {
  const [tab, setTab] = useState<"contribute" | "trade" | "withdraw" | "auto" | "history" | "projection">("contribute");
  const refresh = useRefresh();
  const isRoth = acct.type === "ROTH_IRA";
  const year = new Date().getFullYear();
  const earnings = (acct.value ?? 0) - acct.contributionBasis;
  return (
    <section className="rounded-md border border-border bg-background/40 p-3">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Tag tone="info">{LABEL[acct.type]}</Tag>
            <span className="text-sm font-medium">{acct.name}</span>
          </div>
          <div className="num mt-1 text-[11px] text-muted-foreground">
            opened {dateOnly(acct.openedAt)} · deposited {money(acct.netDeposits)}
            {isRoth && (
              <>
                {" "}
                · basis {money(acct.contributionBasis)} · earnings {money(earnings)} · 5-year clock{" "}
                {acct.firstContributionTaxYear ? (year >= acct.firstContributionTaxYear + 5 ? "met" : `from ${acct.firstContributionTaxYear}, met in ${acct.firstContributionTaxYear + 5}`) : "starts at first contribution"}
              </>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="num text-lg">{acct.value === null ? "—" : money(acct.value)}</div>
          {acct.gain !== null && <Change value={acct.gain} percent={acct.netDeposits > 0 ? (acct.gain / acct.netDeposits) * 100 : null} className="text-[11px]" />}
          {acct.missingPrices.length > 0 && <p className="text-[10px] text-down">no price for {acct.missingPrices.join(", ")}</p>}
        </div>
      </div>
      {acct.holdings.length > 0 && (
        <table className="mb-2 w-full text-[11px]">
          <tbody>
            {acct.holdings.map((h) => (
              <tr key={h.symbol} className="border-t border-border/50">
                <td className="py-0.5 font-mono font-semibold">{h.symbol}</td>
                <td className="num text-right">{fmtQty(h.qty)} sh</td>
                <td className="num text-right">{money(h.value)}</td>
                <td className="text-right">
                  <Change value={h.value === null ? null : h.value - h.costBasis} />
                </td>
              </tr>
            ))}
            <tr className="border-t border-border/50 text-muted-foreground">
              <td className="py-0.5">cash</td>
              <td />
              <td className="num text-right">{money(acct.cash)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      )}
      <div className="mb-2 flex flex-wrap gap-0.5 border-b border-border text-[11px]">
        {(["contribute", "trade", "withdraw", "auto", "history", "projection"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn("border-b-2 px-2 pb-1 capitalize", tab === t ? "border-series-1" : "border-transparent text-muted-foreground")}>
            {t === "auto" ? "auto-contribute" : t}
          </button>
        ))}
        <button
          className="ml-auto pb-1 text-muted-foreground hover:text-down"
          onClick={() => {
            if (window.confirm(`Close the mock ${acct.name}? Its history stays in the ledger.`))
              void api(`/api/accounts/${acct.id}/close`, { method: "POST", body: {} })
                .then(refresh)
                .catch((e: Error) => toast.error(e.message));
          }}
        >
          close account
        </button>
      </div>
      {tab === "contribute" && <Contribute acct={acct} />}
      {tab === "trade" && <Trade acct={acct} />}
      {tab === "withdraw" && <Withdraw acct={acct} />}
      {tab === "auto" && <Schedules acct={acct} schedules={schedules} />}
      {tab === "history" && <History acct={acct} />}
      {tab === "projection" && <Projection acct={acct} profile={profile} />}
    </section>
  );
}

function OpenAccount({ profile, onEditTaxFacts }: { profile: Profile; onEditTaxFacts: () => void }) {
  const types: MockType[] = profile.crossBorder
    ? ["TFSA", "RRSP", "FHSA", "ROTH_IRA", "TRADITIONAL_IRA", "401K", "HSA", "TAXABLE"]
    : profile.country === "CA"
      ? ["TFSA", "RRSP", "FHSA", "TAXABLE"]
      : ["ROTH_IRA", "TRADITIONAL_IRA", "401K", "HSA", "TAXABLE"];
  const [type, setType] = useState<MockType>(types[0]!);
  const refresh = useRefresh();
  const t = profile.tax ?? {};
  const go = useMutation({
    mutationFn: () => api("/api/accounts", { method: "POST", body: { type, name: `Mock ${LABEL[type]}` } }),
    onSuccess: async () => (toast.success(`Opened a mock ${LABEL[type]}`), refresh()),
    onError: (e) => toast.error(e.message),
  });
  const rothMissing = type === "ROTH_IRA" && (t.usEarnedIncome === undefined || !t.filingStatus || t.magi === undefined);
  return (
    <section className="rounded-md border border-dashed border-border p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Open a mock account</span>
        <select aria-label="Account type" className={inp} value={type} onChange={(e) => setType(e.target.value as MockType)}>
          {types.map((x) => (
            <option key={x} value={x}>
              {LABEL[x]}
            </option>
          ))}
        </select>
        <Button size="sm" onClick={() => go.mutate()} disabled={go.isPending}>
          Open
        </Button>
      </div>
      {type === "ROTH_IRA" && (
        <div className="mt-2 space-y-1 text-[11px]">
          <p>
            Eligibility needs US earned income for the year, your filing status, and estimated MAGI.{" "}
            {rothMissing ? (
              <button className="text-series-1 hover:underline" onClick={onEditTaxFacts}>
                Add them under My finances → Tax facts.
              </button>
            ) : (
              <span className="text-muted-foreground">
                On file: earned {money(t.usEarnedIncome)}, {t.filingStatus}, MAGI {money(t.magi)}. Each contribution is checked against the {new Date().getFullYear()} limits.
              </span>
            )}
          </p>
          {profile.crossBorder && (
            <p className="flex gap-1.5 text-amber-300">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              Canada and the US treat Roth IRAs differently depending on residency, and there can be elections/filing steps to keep a Roth tax-free in Canada. Talk to a cross-border tax
              professional before real money goes in.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export function MockAccounts({ profile, onEditTaxFacts }: { profile: Profile; onEditTaxFacts: () => void }) {
  const q = useQuery({ queryKey: ["mock-accounts"], queryFn: () => api<AccountsResponse>("/api/accounts"), refetchInterval: 60_000 });
  const ov = useQuery({
    queryKey: ["mock-overview"],
    queryFn: () => api<{ compare: { plan: { deposits: number; value: number | null; returnPct: number | null }; sandbox: { returnPct: number; since: string } | null; note: string } }>("/api/accounts/overview"),
  });
  if (q.isPending) return <LoadingRows rows={8} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const totalByClass = Object.values(d.location.combined).reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="@container space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background/40 px-3 py-2 text-[11px]">
        <ShieldCheck className="size-3.5 text-up" />
        Limits and rules from official IRS/CRA pages, last verified {d.rules.lastVerified}.
        {d.rules.missing.length > 0 && <span className="text-down">Missing for {d.rules.year}: {d.rules.missing.join(", ")}. Contributions for those are blocked until verified.</span>}
        <span className="ml-auto text-muted-foreground">Mock accounts are simulated with paper money at real prices, separate from the Alpaca trading sandbox.</span>
      </div>

      {ov.data && (
        <section className="rounded-md border border-border bg-background/40 p-3 text-xs">
          <h3 className="mb-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Followed the plan vs stock picking</h3>
          <div className="num flex flex-wrap gap-6">
            <span>
              Plan (mock accounts): {ov.data.compare.plan.returnPct === null ? "—" : <Change percent={ov.data.compare.plan.returnPct} />} on {money(ov.data.compare.plan.deposits)} deposited
            </span>
            <span>Sandbox (Alpaca picks): {ov.data.compare.sandbox ? <Change percent={ov.data.compare.sandbox.returnPct} /> : "—"}</span>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">{ov.data.compare.note}</p>
        </section>
      )}

      <OpenAccount profile={profile} onEditTaxFacts={onEditTaxFacts} />

      {d.accounts.length === 0 ? (
        <EmptyState title="No mock accounts yet" hint="Open one above, e.g. a Roth IRA or TFSA, and practice contributing and investing by the plan." />
      ) : (
        <div className="grid gap-3 @5xl:grid-cols-2">
          {d.accounts.map((a) => (
            <AccountCard key={a.id} acct={a} schedules={d.schedules} profile={profile} />
          ))}
        </div>
      )}

      {d.accounts.length > 0 && (
        <section className="rounded-md border border-border bg-background/40 p-3 text-xs">
          <h3 className="mb-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">What goes where (whole household)</h3>
          <p className="mb-2 text-[11px] text-muted-foreground">
            Target from your risk profile:{" "}
            {Object.entries(d.location.target)
              .map(([k, v]) => `${CLASS_LABEL[k] ?? k} ${pct(v * 100, { sign: false, digits: 0 })}`)
              .join(" · ")}
            . The household stays on target across all accounts combined, not each account separately.
          </p>
          <table className="w-full text-[11px]">
            <thead className="text-[10px] text-muted-foreground uppercase">
              <tr className="text-left">
                <th className="py-1 font-medium">Account</th>
                {Object.keys(CLASS_LABEL).map((c) => (
                  <th key={c} className="text-right font-medium">
                    {CLASS_LABEL[c]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.location.perAccount.map((p) => (
                <tr key={p.accountId} className="border-t border-border/50">
                  <td className="py-1">
                    {LABEL[p.type as MockType] ?? p.type} <span className="text-muted-foreground">({p.treatment.replace("_", "-")})</span>
                  </td>
                  {Object.keys(CLASS_LABEL).map((c) => (
                    <td key={c} className="num text-right">
                      {p.holdings[c] ? money(p.holdings[c], { whole: true }) : ""}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-t border-border font-medium">
                <td className="py-1">Combined</td>
                {Object.keys(CLASS_LABEL).map((c) => (
                  <td key={c} className="num text-right">
                    {d.location.combined[c] ? `${((d.location.combined[c] / totalByClass) * 100).toFixed(0)}%` : ""}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          <ul className="mt-2 space-y-0.5 text-[10px] text-muted-foreground">
            {Object.entries(d.location.reasons).map(([k, v]) => (
              <li key={k}>
                <b>{CLASS_LABEL[k]}</b>: {v}
              </li>
            ))}
            <li>Mock accounts hold US-listed ETFs because the free data feed only prices US-listed securities; Canadian-listed equivalents (e.g. XEQT/VCN) behave similarly in CAD.</li>
          </ul>
        </section>
      )}
    </div>
  );
}
