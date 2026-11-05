import { sql } from "drizzle-orm";
import { db } from "@/db";
import { cache } from "../cache";

export interface StepResult {
  step: string;
  ok: boolean;
  detail?: string;
}

/**
 * The daily job (Vercel cron after the US close, GitHub Actions as backup,
 * `pnpm cron:daily` locally). Every step must be idempotent: running twice is
 * harmless. Later phases add: equity snapshot, order/fill sync, earnings checks.
 */
export async function runDailyJob(): Promise<{ ok: boolean; steps: StepResult[]; ranAt: string }> {
  const steps: StepResult[] = [];
  const step = async (name: string, fn: () => Promise<string | undefined>) => {
    try {
      steps.push({ step: name, ok: true, detail: await fn() });
    } catch (e) {
      steps.push({ step: name, ok: false, detail: e instanceof Error ? e.message : String(e) });
    }
  };

  await step("prune-cache", async () => {
    await cache.prune();
    return "expired cache rows older than 24h removed";
  });
  await step("prune-usage", async () => {
    await db().execute(sql`delete from api_usage where minute < now() - interval '7 days'`);
    return "usage counters older than 7 days removed";
  });

  return { ok: steps.every((s) => s.ok), steps, ranAt: new Date().toISOString() };
}
