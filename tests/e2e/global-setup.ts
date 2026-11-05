import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { createDb } from "../../src/db";
import { E2E_DATABASE_URL } from "../../playwright.config";

/** Fresh e2e database each run: create if missing, migrate, wipe state. */
export default async function setup() {
  const url = new URL(E2E_DATABASE_URL);
  const name = url.pathname.slice(1);
  const admin = postgres({ host: url.hostname, port: Number(url.port), user: url.username, password: url.password, database: "postgres", max: 1 });
  const exists = await admin`select 1 from pg_database where datname = ${name}`;
  if (!exists.length) await admin.unsafe(`create database "${name}"`);
  await admin.end();

  const { db, client } = createDb(E2E_DATABASE_URL, { max: 1 });
  await migrate(db, { migrationsFolder: "./drizzle" });
  await client.unsafe(
    "truncate demo_state, watchlist_items, watchlists, journal_entries, orders, fills, equity_snapshots, alerts, alert_events, api_cache, rate_limits, api_usage, settings, assets restart identity cascade",
  );
  await client.end();
}
