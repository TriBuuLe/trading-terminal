/** Time helpers in America/New_York (the US market's clock). Shared by client and server. */
const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function etParts(d: Date): { date: string; minutes: number; weekday: number } {
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return { date, minutes, weekday };
}

/** "09:30" or "0930" -> minutes after midnight. */
export function hhmmToMinutes(s: string): number {
  const m = /^(\d{1,2}):?(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`bad time ${s}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Convert an ET wall-clock date + "HH:MM" to a real Date (handles DST). */
export function etToDate(date: string, hhmm: string): Date {
  const mins = hhmmToMinutes(hhmm);
  const h = Math.floor(mins / 60);
  const mi = mins % 60;
  // Guess with -05:00, then correct by the observed offset.
  const guess = new Date(`${date}T${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:00-05:00`);
  const observed = etParts(guess).minutes;
  const diff = mins - observed;
  return new Date(guess.getTime() + diff * 60_000);
}

export function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return "0s";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${String(sec).padStart(2, "0")}s`;
}
