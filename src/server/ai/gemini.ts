import { db } from "@/db";
import { env } from "../env";
import { UpstreamError } from "../http";
import { PgTokenBucket } from "../rate-limiter";

/**
 * Gemini through the Interactions API (the only endpoint this key type supports).
 * Models are tried strongest first; "high demand" / rate-limit answers fall back
 * to the next one. store:false: Google doesn't keep the interaction for later
 * turns (free-tier terms still let Google use prompts to improve its products).
 */
declare global {
  var __folioGemini: PgTokenBucket | undefined;
}
// Free tier: ~15 requests/min; stay under it.
const limiter = () => (globalThis.__folioGemini ??= new PgTokenBucket(db, "gemini", 3, 10));

interface InteractionResponse {
  steps?: { type: string; content?: { type: string; text?: string }[] }[];
  error?: { message?: string; code?: string | number };
  model?: string;
}

export function aiAvailable(): { ok: true } | { ok: false; reason: string } {
  const e = env();
  if (e.LLM_PROVIDER !== "gemini") return { ok: false, reason: "The assistant is set up for Gemini only (LLM_PROVIDER=gemini)." };
  if (!e.GEMINI_API_KEY) return { ok: false, reason: "GEMINI_API_KEY isn't set in .env.local." };
  if (!e.ALLOW_PROVIDER_TRAINING_ON_DATA) return { ok: false, reason: "Gemini's free tier may use prompts to improve Google's products. Set ALLOW_PROVIDER_TRAINING_ON_DATA=true to allow it." };
  return { ok: true };
}

export async function generate(i: { system: string; input: string; temperature?: number }): Promise<{ text: string; model: string }> {
  const a = aiAvailable();
  if (!a.ok) throw new UpstreamError("gemini", 503, a.reason);
  await limiter().acquire();
  const e = env();
  let last = "no model answered";
  // Two passes over the models: free-tier "high demand" spikes usually clear in seconds.
  for (const model of [...e.GEMINI_MODELS, ...e.GEMINI_MODELS]) {
    if (model === e.GEMINI_MODELS[0] && last !== "no model answered") await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: { "x-goog-api-key": e.GEMINI_API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({ model, system_instruction: i.system, input: i.input, store: false, generation_config: { temperature: i.temperature ?? 0.2 } }),
      signal: AbortSignal.timeout(90_000),
    }).catch((err: unknown) => ({ ok: false, status: 0, json: async () => ({ error: { message: String(err) } }) }) as unknown as Response);
    const body = (await res.json().catch(() => ({}))) as InteractionResponse;
    if (res.ok && !body.error) {
      const text = (body.steps ?? [])
        .filter((s) => s.type === "model_output")
        .flatMap((s) => s.content ?? [])
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text)
        .join("\n")
        .trim();
      if (text) return { text, model };
      last = `${model}: empty answer`;
      continue;
    }
    last = `${model}: ${body.error?.message ?? `HTTP ${res.status}`}`;
    // Try the next model on overload / rate limit / unavailable; stop on auth or bad-request errors.
    if (![0, 429, 500, 503, 504].includes(res.status) && !/demand|unavailable|overloaded|rate/i.test(body.error?.message ?? "")) break;
  }
  throw new UpstreamError("gemini", 502, last);
}
