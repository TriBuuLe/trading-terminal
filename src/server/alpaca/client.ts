import type { z } from "zod";
import { env } from "../env";
import { requestJson, withQuery, type Query } from "../http";
import { limiters } from "../limits";
import { ALPACA_PAPER_TRADING_URL } from "../paper-guard";

export const ALPACA_DATA_URL = "https://data.alpaca.markets";

function authHeaders(): Record<string, string> {
  const e = env();
  if (!e.ALPACA_API_KEY_ID || !e.ALPACA_API_SECRET_KEY) {
    throw new Error("Alpaca keys are not configured");
  }
  return {
    "APCA-API-KEY-ID": e.ALPACA_API_KEY_ID,
    "APCA-API-SECRET-KEY": e.ALPACA_API_SECRET_KEY,
  };
}

interface CallOpts<S extends z.ZodType> {
  schema: S;
  query?: Query;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  retries?: number;
}

/** Paper Trading API. The base URL is the hardcoded paper host; there is no override. */
export function trading<S extends z.ZodType>(path: string, opts: CallOpts<S>): Promise<z.infer<S>> {
  return requestJson({
    service: "alpaca-trading",
    url: withQuery(`${ALPACA_PAPER_TRADING_URL}${path}`, opts.query),
    schema: opts.schema,
    limiter: limiters.alpacaTrading,
    headers: authHeaders(),
    method: opts.method,
    body: opts.body,
    retries: opts.retries,
  });
}

/** Market Data API (also hosts News and Screener under /v1beta1). */
export function data<S extends z.ZodType>(path: string, opts: CallOpts<S>): Promise<z.infer<S>> {
  return requestJson({
    service: "alpaca-data",
    url: withQuery(`${ALPACA_DATA_URL}${path}`, opts.query),
    schema: opts.schema,
    limiter: limiters.alpacaData,
    headers: authHeaders(),
    method: opts.method,
    body: opts.body,
    retries: opts.retries,
  });
}

export function feed(): "iex" | "sip" {
  return env().ALPACA_DATA_FEED;
}
