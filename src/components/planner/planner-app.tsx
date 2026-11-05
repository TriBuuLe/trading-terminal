"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Profile } from "@/lib/planner/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingRows } from "../terminal/bits";
import { AssumptionsAndData } from "./assumptions";
import { PlanOverview } from "./overview";
import { AccountSection, BasicsSection, DebtSection, emptyProfile, ExpenseSection, GoalSection, IncomeSection, RiskSection, SettingsSection, WIZARD_STEPS } from "./profile-editor";
import { Transactions } from "./transactions";

type Tab = "overview" | "finances" | "transactions" | "assumptions";

function useSaveProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: Profile) => api("/api/finances/profile", { method: "PUT", body: p }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["profile"] });
      await qc.invalidateQueries({ queryKey: ["plan"] });
      await qc.invalidateQueries({ queryKey: ["checkin"] });
    },
  });
}

function Wizard({ onDone }: { onDone: () => void }) {
  const [p, setP] = useState<Profile>(emptyProfile);
  const [step, setStep] = useState(0);
  const save = useSaveProfile();
  const S = WIZARD_STEPS[step]!;
  const last = step === WIZARD_STEPS.length - 1;
  return (
    <div className="mx-auto max-w-4xl space-y-3 p-4">
      <div>
        <h2 className="text-base font-semibold">Set up your plan</h2>
        <p className="text-xs text-muted-foreground">
          About 5 minutes. Everything is encrypted in your database and stays behind your login. You can change any of it later under My finances.
        </p>
      </div>
      <ol className="flex flex-wrap gap-1 text-[11px]">
        {WIZARD_STEPS.map((s, i) => (
          <li key={s.key}>
            <button onClick={() => setStep(i)} className={cn("rounded px-2 py-1", i === step ? "bg-secondary font-medium" : i < step ? "text-up" : "text-muted-foreground")}>
              {i + 1}. {s.label}
            </button>
          </li>
        ))}
      </ol>
      <S.C p={p} set={(fn) => setP(fn)} />
      <div className="flex justify-between">
        <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
          Back
        </Button>
        {last ? (
          <Button
            disabled={save.isPending}
            onClick={() =>
              save.mutate(p, {
                onSuccess: () => {
                  toast.success("Plan created");
                  onDone();
                },
                onError: (e) => toast.error(e.message),
              })
            }
          >
            {save.isPending ? "Saving…" : "Build my plan"}
          </Button>
        ) : (
          <Button onClick={() => setStep((s) => s + 1)}>Next</Button>
        )}
      </div>
    </div>
  );
}

function MyFinances({ initial }: { initial: Profile }) {
  const [p, setP] = useState<Profile>(initial);
  const save = useSaveProfile();
  const dirty = JSON.stringify(p) !== JSON.stringify(initial);
  const set = (fn: (x: Profile) => Profile) => setP(fn);
  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-10 flex items-center justify-between rounded-md border border-border bg-panel/95 px-3 py-2 backdrop-blur">
        <span className="text-xs text-muted-foreground">{dirty ? "Unsaved changes" : "All changes saved"}</span>
        <div className="flex gap-2">
          {dirty && (
            <Button size="sm" variant="ghost" onClick={() => setP(initial)}>
              Discard
            </Button>
          )}
          <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate(p, { onSuccess: () => toast.success("Saved: plan updated"), onError: (e) => toast.error(e.message) })}>
            {save.isPending ? "Saving…" : "Save & recalculate"}
          </Button>
        </div>
      </div>
      <BasicsSection p={p} set={set} />
      <IncomeSection p={p} set={set} />
      <ExpenseSection p={p} set={set} />
      <DebtSection p={p} set={set} />
      <AccountSection p={p} set={set} />
      <GoalSection p={p} set={set} />
      <RiskSection p={p} set={set} />
      <SettingsSection p={p} set={set} />
    </div>
  );
}

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "My plan" },
  { id: "finances", label: "My finances" },
  { id: "transactions", label: "Transactions" },
  { id: "assumptions", label: "Assumptions & data" },
];

export function PlannerApp() {
  const [tab, setTab] = useState<Tab>("overview");
  const q = useQuery({ queryKey: ["profile"], queryFn: () => api<{ profile: Profile | null }>("/api/finances/profile") });

  if (q.isPending) return <LoadingRows rows={10} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data.profile) return <Wizard onDone={() => setTab("overview")} />;
  const profile = q.data.profile;

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <nav className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border px-3" aria-label="Planner">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn("rounded px-2.5 py-1 text-xs", tab === t.id ? "bg-secondary font-medium" : "text-muted-foreground hover:bg-accent hover:text-foreground")}
          >
            {t.label}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-muted-foreground">Educational planning tool, not financial advice. All math is deterministic and shown with its assumptions.</span>
      </nav>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto p-3">
        <div className="mx-auto max-w-6xl">
          {tab === "overview" && <PlanOverview country={profile.country} />}
          {tab === "finances" && <MyFinances key={JSON.stringify(profile)} initial={profile} />}
          {tab === "transactions" && <Transactions />}
          {tab === "assumptions" && <AssumptionsAndData />}
        </div>
      </div>
    </div>
  );
}
