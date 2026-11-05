import { z } from "zod";
import { RateLimitedError, type Limiter } from "./rate-limiter";

export class UpstreamError extends Error {
  constructor(
    readonly service: string,
    readonly status: number,
    message: string,
    readonly code?: number | string,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

export class SchemaError extends Error {
  constructor(
    readonly service: string,
    readonly path: string,
    readonly issues: string,
  ) {
    super(`${service} ${path}: response did not match expected schema: ${issues}`);
    this.name = "SchemaError";
  }
}

export type Query = Record<string, string | number | boolean | undefined | null>;

export function withQuery(url: string, query?: Query): string {
  if (!query) return url;
  const u = new URL(url);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
  }
  return u.toString();
}

export interface RequestOpts<S extends z.ZodType> {
  service: string;
  url: string;
  schema: S;
  limiter: Limiter;
  headers?: Record<string, string>;
  method?: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  body?: unknown;
  timeoutMs?: number;
  /** Retry 429/5xx with backoff. Never set for non-idempotent order placement. */
  retries?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Rate-limited, timed-out, schema-validated JSON request. */
export async function requestJson<S extends z.ZodType>(opts: RequestOpts<S>): Promise<z.infer<S>> {
  const { service, url, schema, limiter, method = "GET", timeoutMs = 10_000 } = opts;
  const retries = opts.retries ?? (method === "GET" ? 2 : 0);
  let attempt = 0;
  for (;;) {
    await limiter.acquire();
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Accept: "application/json",
          ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...opts.headers,
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
    } catch (e) {
      if (attempt < retries) {
        attempt++;
        await sleep(300 * 2 ** attempt);
        continue;
      }
      const msg = e instanceof Error ? e.message : String(e);
      throw new UpstreamError(service, 0, `network error: ${msg}`);
    }

    if (res.status === 429) {
      // Upstream says slow down: block this service for everyone (all instances),
      // then retry once the window passes (the limiter does the waiting).
      const ra = Number(res.headers.get("retry-after"));
      await limiter.block(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 5_000 * 2 ** attempt);
      if (attempt < Math.max(retries, 1)) {
        attempt++;
        continue;
      }
    } else if (res.status >= 500 && attempt < retries) {
      attempt++;
      await sleep(500 * 2 ** attempt);
      continue;
    }

    const text = await res.text();
    let json: unknown = undefined;
    if (text.length > 0) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    }

    if (!res.ok) {
      const obj = (json ?? {}) as { message?: unknown; code?: unknown; error?: unknown };
      const message =
        typeof obj.message === "string"
          ? obj.message
          : typeof obj.error === "string"
            ? obj.error
            : text.trimStart().startsWith("<") || text.length === 0
              ? `HTTP ${res.status} ${res.statusText || (res.status === 401 ? "Unauthorized" : "")}`.trim()
              : text.slice(0, 300);
      const code = typeof obj.code === "number" || typeof obj.code === "string" ? obj.code : undefined;
      throw new UpstreamError(service, res.status, message, code);
    }

    const parsed = schema.safeParse(json ?? null);
    if (!parsed.success) {
      const path = new URL(url).pathname;
      const issues = parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      throw new SchemaError(service, path, issues);
    }
    return parsed.data;
  }
}

/** Shape API route errors consistently for the client. */
export function errorResponse(e: unknown): Response {
  if (e instanceof UpstreamError) {
    return Response.json(
      { error: e.message, service: e.service, upstreamStatus: e.status, code: e.code ?? null },
      { status: e.status >= 400 && e.status < 500 ? e.status : 502 },
    );
  }
  if (e instanceof RateLimitedError) {
    return Response.json({ error: e.message, rateLimited: true }, { status: 503, headers: { "Retry-After": "5" } });
  }
  if (e instanceof SchemaError) {
    return Response.json({ error: e.message, service: e.service }, { status: 502 });
  }
  if (e instanceof z.ZodError) {
    const problems = e.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`);
    return Response.json({ error: problems[0] ?? "Invalid request", problems }, { status: 400 });
  }
  if (e instanceof Error && "problems" in e && "status" in e && typeof e.status === "number") {
    // OrderRejectedError (kept structural to avoid a circular import)
    return Response.json({ error: e.message, problems: e.problems }, { status: e.status });
  }
  const msg = e instanceof Error ? e.message : String(e);
  return Response.json({ error: msg }, { status: 500 });
}
