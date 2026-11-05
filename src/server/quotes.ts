import type { Quote, TradeSession } from "@/lib/types";
import { etParts } from "@/lib/time";
import type { Snapshot } from "./alpaca/schemas";

function tradeSession(iso: string): TradeSession {
  const { minutes, weekday } = etParts(new Date(iso));
  if (weekday === 0 || weekday === 6) return "overnight";
  if (minutes < 4 * 60 || minutes >= 20 * 60) return "overnight";
  if (minutes < 9 * 60 + 30) return "pre";
  if (minutes >= 16 * 60) return "after";
  return "regular";
}

/**
 * Normalize an Alpaca snapshot into a quote with a correct reference close.
 * If the last trade happened on a later ET date than `dailyBar` (e.g. pre-market
 * before today's first regular bar), the reference close is `dailyBar.c`;
 * otherwise it's `prevDailyBar.c` and the day's OHLCV comes from `dailyBar`.
 */
export function normalizeSnapshot(symbol: string, s: Snapshot | null | undefined): Quote {
  const empty: Quote = {
    symbol,
    price: null,
    prevClose: null,
    change: null,
    changePct: null,
    open: null,
    high: null,
    low: null,
    volume: null,
    bid: null,
    ask: null,
    tradeTime: null,
    tradeSession: null,
  };
  if (!s) return empty;
  const trade = s.latestTrade ?? null;
  const quote = s.latestQuote ?? null;
  const daily = s.dailyBar ?? null;
  const prev = s.prevDailyBar ?? null;

  const price = trade?.p ?? daily?.c ?? null;
  const tradeDate = trade ? etParts(new Date(trade.t)).date : null;
  const dailyDate = daily ? etParts(new Date(daily.t)).date : null;
  const newSession = Boolean(tradeDate && dailyDate && tradeDate > dailyDate);

  const prevClose = newSession ? (daily?.c ?? null) : (prev?.c ?? null);
  const today = newSession ? null : daily;
  const change = price !== null && prevClose !== null ? price - prevClose : null;
  const changePct = change !== null && prevClose ? (change / prevClose) * 100 : null;

  // A zero bid/ask means "no quote" on IEX; don't report it as a price.
  const bid = quote && quote.bp > 0 ? quote.bp : null;
  const ask = quote && quote.ap > 0 ? quote.ap : null;

  return {
    symbol,
    price,
    prevClose,
    change,
    changePct,
    open: today?.o ?? null,
    high: today?.h ?? null,
    low: today?.l ?? null,
    volume: today?.v ?? null,
    bid,
    ask,
    tradeTime: trade?.t ?? null,
    tradeSession: trade ? tradeSession(trade.t) : null,
  };
}
