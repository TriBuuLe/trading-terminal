import { etParts, etToDate, hhmmToMinutes } from "./time";

export type Session = "open" | "pre" | "after" | "closed";

export interface CalendarDay {
  date: string;
  open: string; // "09:30"
  close: string; // "16:00" (13:00 on early-close days)
  session_open?: string; // "0400"
  session_close?: string; // "2000"
}

export interface ClockLike {
  is_open: boolean;
  next_open: string;
  next_close: string;
}

export interface MarketStatus {
  session: Session;
  /** What the countdown counts down to. */
  nextEvent: "open" | "close" | "pre-open";
  nextEventAt: string;
  isTradingDay: boolean;
  serverTime: string;
}

/**
 * Classify the US equity session. Regular hours come from Alpaca's clock
 * (authoritative, handles holidays/early closes); pre/after-hours windows
 * come from the calendar's session_open/session_close.
 */
export function classifySession(now: Date, clock: ClockLike, today: CalendarDay | null): MarketStatus {
  const base = { serverTime: now.toISOString(), isTradingDay: Boolean(today) };
  if (clock.is_open) {
    return { ...base, session: "open", nextEvent: "close", nextEventAt: clock.next_close };
  }
  if (today) {
    const { minutes } = etParts(now);
    const open = hhmmToMinutes(today.open);
    const close = hhmmToMinutes(today.close);
    const preStart = hhmmToMinutes(today.session_open ?? "0400");
    const afterEnd = hhmmToMinutes(today.session_close ?? "2000");
    if (minutes >= preStart && minutes < open) {
      return { ...base, session: "pre", nextEvent: "open", nextEventAt: etToDate(today.date, today.open).toISOString() };
    }
    if (minutes >= close && minutes < afterEnd) {
      return { ...base, session: "after", nextEvent: "open", nextEventAt: clock.next_open };
    }
  }
  return { ...base, session: "closed", nextEvent: "open", nextEventAt: clock.next_open };
}
