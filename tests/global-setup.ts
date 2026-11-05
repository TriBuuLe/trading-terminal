import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "../src/db";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://paper:paper@localhost:5433/paper_terminal_test";

/** Migrate the dedicated test database once before the suite. */
export default async function setup() {
  const { db, client } = createDb(TEST_DATABASE_URL, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
  } catch (e) {
    throw new Error(
      `Test DB unavailable at ${TEST_DATABASE_URL}. Start it with: docker compose up -d db ` +
        `&& docker compose exec db psql -U paper -d paper_terminal -c "create database paper_terminal_test"\n${String(e)}`,
    );
  } finally {
    await client.end();
  }
}
