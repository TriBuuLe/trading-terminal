import { z } from "zod";

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());
const bool = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toLowerCase() === "true" : v),
  z.boolean(),
);

export const envSchema = z
  .object({
    ALPACA_API_KEY_ID: optionalString,
    ALPACA_API_SECRET_KEY: optionalString,
    ALPACA_DATA_FEED: z.preprocess(emptyToUndefined, z.enum(["iex", "sip"]).default("iex")),
    FINNHUB_API_KEY: optionalString,
    SLIPPAGE_BPS: z.preprocess(emptyToUndefined, z.coerce.number().min(0).max(500).default(5)),
    COMMISSION_PER_TRADE: z.preprocess(emptyToUndefined, z.coerce.number().min(0).default(0)),
    QUOTE_POLL_MS: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1000).max(60_000).default(3000)),
    DATABASE_URL: z.preprocess(emptyToUndefined, z.url({ protocol: /^postgres(ql)?$/ })),
    AUTH_SECRET: z.preprocess(emptyToUndefined, z.string().min(32, "AUTH_SECRET must be at least 32 chars")),
    AUTH_GITHUB_ID: optionalString,
    AUTH_GITHUB_SECRET: optionalString,
    ALLOWED_GITHUB_USER: optionalString,
    CRON_SECRET: z.preprocess(emptyToUndefined, z.string().min(16, "CRON_SECRET must be at least 16 chars")),
    DEMO_MODE: z.preprocess(emptyToUndefined, bool.default(false)),
    DATA_ENCRYPTION_KEY: z.preprocess(
      emptyToUndefined,
      z.string().refine((v) => Buffer.from(v, "base64").length === 32, "DATA_ENCRYPTION_KEY must be 32 bytes base64 (openssl rand -base64 32)"),
    ),
    LLM_PROVIDER: z.preprocess(emptyToUndefined, z.enum(["gemini", "ollama"]).default("gemini")),
    GEMINI_API_KEY: optionalString,
    // Ordered fallback list (strongest first). Verified against Google's model list 2026-11-04.
    GEMINI_MODELS: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .default("gemini-3.8-flash,gemini-3.5-flash-lite")
        .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)),
    ),
    OLLAMA_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().default("http://localhost:11434")),
    OLLAMA_MODEL: optionalString,
    ALLOW_PROVIDER_TRAINING_ON_DATA: z.preprocess(emptyToUndefined, bool.default(false)),
  })
  .superRefine((e, ctx) => {
    if (!e.DEMO_MODE && (!e.ALPACA_API_KEY_ID || !e.ALPACA_API_SECRET_KEY)) {
      ctx.addIssue({
        code: "custom",
        message:
          "ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY are required (paper keys). Set DEMO_MODE=true to run without them.",
        path: ["ALPACA_API_KEY_ID"],
      });
    }
    if (!e.ALLOWED_GITHUB_USER) {
      ctx.addIssue({
        code: "custom",
        message: "ALLOWED_GITHUB_USER is required: the only GitHub username allowed to log in.",
        path: ["ALLOWED_GITHUB_USER"],
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function parseEnv(raw: Record<string, string | undefined>): Env {
  const r = envSchema.safeParse(raw);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${msg}`);
  }
  return r.data;
}
