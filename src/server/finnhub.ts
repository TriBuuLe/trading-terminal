import type { z } from "zod";
import { env } from "./env";
import { requestJson, withQuery, type Query } from "./http";
import { limiters } from "./limits";

const FINNHUB_URL = "https://finnhub.io/api/v1";

export function finnhubConfigured(): boolean {
  return Boolean(env().FINNHUB_API_KEY);
}

/** Finnhub call. Key goes in the X-Finnhub-Token header (documented alternative to ?token=). */
export function finnhub<S extends z.ZodType>(path: string, schema: S, query?: Query): Promise<z.infer<S>> {
  const key = env().FINNHUB_API_KEY;
  if (!key) throw new Error("FINNHUB_API_KEY is not configured");
  return requestJson({
    service: "finnhub",
    url: withQuery(`${FINNHUB_URL}${path}`, query),
    schema,
    limiter: limiters.finnhub,
    headers: { "X-Finnhub-Token": key },
  });
}
