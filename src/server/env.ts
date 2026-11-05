// NOTE: no `import "server-only"` here: this module is also loaded by the worker
// process (plain Node via tsx), where that package throws. Nothing under
// src/server/** may be imported from client components; the ESLint rule in
// eslint.config.mjs enforces that.
import { assertPaperOnly } from "./paper-guard";
import { parseEnv, type Env } from "./env-schema";

export type { Env };

declare global {
  var __folioEnv: Env | undefined;
}

/**
 * Validated server env. Throws (so the server refuses to serve) if config is
 * invalid or anything points at live trading.
 */
export function env(): Env {
  if (!globalThis.__folioEnv) {
    assertPaperOnly(process.env);
    globalThis.__folioEnv = parseEnv(process.env);
  }
  return globalThis.__folioEnv;
}
