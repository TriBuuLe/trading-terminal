import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;

declare global {
  var __folioDb: { db: DB; client: postgres.Sql } | undefined;
}

export function createDb(url: string, opts: { max?: number } = {}): { db: DB; client: postgres.Sql } {
  const client = postgres(url, {
    // Neon's pooled endpoint (PgBouncer, transaction mode) doesn't support
    // named prepared statements; disabling them works for local Postgres too.
    prepare: false,
    // Serverless: keep the per-instance pool tiny.
    max: opts.max ?? (process.env.VERCEL ? 1 : 5),
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  });
  return { db: drizzle(client, { schema }), client };
}

/** Per-process connection (reused across warm invocations and dev hot reloads). */
export function db(): DB {
  if (!globalThis.__folioDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalThis.__folioDb = createDb(url);
  }
  return globalThis.__folioDb.db;
}

export { schema };
