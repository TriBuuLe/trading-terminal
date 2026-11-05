import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { alertEvents, alerts } from "@/db/schema";

export const REPEAT_COOLDOWN_MIN = 15;

export async function listAlerts() {
  return db().select().from(alerts).orderBy(desc(alerts.active), desc(alerts.createdAt));
}

export async function recentEvents(limit = 100) {
  return db().select().from(alertEvents).orderBy(desc(alertEvents.firedAt)).limit(limit);
}

/**
 * Fire an alert at most once (or once per cooldown if repeating), atomically:
 * concurrent tabs racing to fire the same alert produce a single event.
 */
export async function fireAlert(id: number, price: number | null, message: string): Promise<boolean> {
  const updated = await db()
    .update(alerts)
    .set({ lastFiredAt: new Date(), active: sql`${alerts.repeat}` })
    .where(
      and(
        eq(alerts.id, id),
        eq(alerts.active, true),
        sql`(${alerts.lastFiredAt} is null or ${alerts.lastFiredAt} < now() - make_interval(mins => ${REPEAT_COOLDOWN_MIN}))`,
      ),
    )
    .returning({ id: alerts.id, symbol: alerts.symbol, kind: alerts.kind });
  const a = updated[0];
  if (!a) return false;
  await db().insert(alertEvents).values({ alertId: a.id, symbol: a.symbol, kind: a.kind, message, price });
  return true;
}
