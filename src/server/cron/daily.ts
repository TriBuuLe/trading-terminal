import { and, eq, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { alertEvents, alerts, equitySnapshots, watchlistItems } from "@/db/schema";
import { dateOnly } from "@/lib/format";
import { addDaysIso, etParts } from "@/lib/time";
import { getSnapshots } from "../alpaca/market";
import { getAccount, getCalendar, getPositions } from "../alpaca/trading";
import { cache } from "../cache";
import { finnhubConfigured } from "../finnhub";
import { nextEarnings } from "../fundamentals";
import { syncAssets } from "../orders";
import { normalizeSnapshot } from "../quotes";
import { applyAutoRoll } from "../finances";
import { runSchedules } from "../mock-broker";
import { syncFills, syncOrders } from "../sync";

export interface StepResult {
  step: string;
  ok: boolean;
  detail?: string;
}

/** Default "earnings soon" window for held positions (no explicit alert needed). */
const HELD_EARNINGS_DAYS = 7;

/**
 * The daily job: Vercel cron after the US close (GitHub Actions as backup,
 * `pnpm cron:daily` locally). Every step is idempotent, so a double run is harmless:
 *  - snapshots upsert on (date, account)
 *  - orders/fills upsert on Alpaca ids
 *  - earnings events are de-duplicated per symbol + earnings date
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

  await step("sync-orders", async () => `${await syncOrders()} orders upserted`);
  await step("sync-fills", async () => `${await syncFills({ force: true })} fills fetched (duplicates ignored)`);

  await step("equity-snapshot", async () => {
    const today = etParts(new Date()).date;
    const cal = await getCalendar(addDaysIso(today, -7), today);
    // Snapshot the most recent session that has closed (today after 16:00 ET, else the previous one).
    const { minutes } = etParts(new Date());
    const closed = cal.filter((d) => d.date < today || (d.date === today && minutes >= 16 * 60 + 5));
    const session = closed[closed.length - 1];
    if (!session) return "no closed session found";
    const a = await getAccount(true);
    const spySnap = (await getSnapshots(["SPY"], { fresh: true })).SPY;
    // Prefer the session's official daily bar close; fall back to the last trade.
    const spyDaily = spySnap?.dailyBar && etParts(new Date(spySnap.dailyBar.t)).date === session.date ? spySnap.dailyBar.c : null;
    const spy = { price: spyDaily ?? normalizeSnapshot("SPY", spySnap).price };
    const row = {
      date: session.date,
      accountNumber: a.account_number,
      equity: a.equity,
      cash: a.cash,
      longMarketValue: a.long_market_value ?? null,
      spyClose: session.date === today ? spy.price : null,
      takenAt: new Date(),
    };
    await db()
      .insert(equitySnapshots)
      .values(row)
      .onConflictDoUpdate({
        target: [equitySnapshots.date, equitySnapshots.accountNumber],
        set: { equity: row.equity, cash: row.cash, longMarketValue: row.longMarketValue, spyClose: row.spyClose, takenAt: row.takenAt },
      });
    return `${session.date}: equity ${a.equity}${row.spyClose ? `, SPY ${row.spyClose}` : ""}`;
  });

  await step("earnings-check", async () => {
    if (!finnhubConfigured()) return "skipped: FINNHUB_API_KEY not set";
    const [positions, explicit, watched] = await Promise.all([
      getPositions(),
      db().select().from(alerts).where(and(eq(alerts.kind, "earnings"), eq(alerts.active, true))),
      db().selectDistinct({ symbol: watchlistItems.symbol }).from(watchlistItems),
    ]);
    // Window per symbol: explicit alert threshold, else 7 days for holdings.
    const window = new Map<string, number>();
    for (const p of positions) window.set(p.symbol, HELD_EARNINGS_DAYS);
    for (const a of explicit) window.set(a.symbol, Math.max(window.get(a.symbol) ?? 0, a.threshold ?? HELD_EARNINGS_DAYS));
    const today = etParts(new Date()).date;
    let created = 0;
    const checked = [...window.keys()];
    for (const symbol of checked) {
      const e = await nextEarnings(symbol, 30);
      if (!e) continue;
      const days = Math.round((new Date(`${e.date}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 86400_000);
      if (days < 0 || days > window.get(symbol)!) continue;
      const msg = `${symbol} reports earnings ${dateOnly(e.date)}${e.hour === "bmo" ? " before the open" : e.hour === "amc" ? " after the close" : ""} (in ${days} day${days === 1 ? "" : "s"}).`;
      const marker = `${symbol} reports earnings ${dateOnly(e.date)}%`;
      const exists = await db().select({ id: alertEvents.id }).from(alertEvents).where(and(eq(alertEvents.kind, "earnings"), like(alertEvents.message, marker))).limit(1);
      if (exists.length) continue;
      const alertId = explicit.find((a) => a.symbol === symbol)?.id ?? null;
      await db().insert(alertEvents).values({ alertId, symbol, kind: "earnings", message: msg, price: null });
      created++;
    }
    return `checked ${checked.length} symbols (${watched.length} watched not auto-checked), ${created} new earnings notices`;
  });

  await step("monthly-balance-update", async () => {
    const r = await applyAutoRoll();
    return r.length ? `applied ${r.map((e) => `${e.month} (${e.source})`).join(", ")}` : "nothing to apply (off, or no finished month pending)";
  });

  await step("auto-contributions", async () => {
    const r = await runSchedules();
    return r.length ? r.join("; ") : "no schedules due";
  });

  await step("sync-assets", async () => {
    // Once a day is plenty; the list rarely changes.
    const n = await cache.getOrLoad("sync:assets", 20 * 60 * 60_000, syncAssets);
    return `${n} assets`;
  });

  await step("prune", async () => {
    await cache.prune();
    await db().execute(sql`delete from api_usage where minute < now() - interval '7 days'`);
    await db().delete(alertEvents).where(and(eq(alertEvents.seen, true), sql`${alertEvents.firedAt} < now() - interval '180 days'`));
    return "old cache rows, usage counters and seen alert events removed";
  });

  return { ok: steps.every((s) => s.ok), steps, ranAt: new Date().toISOString() };
}

