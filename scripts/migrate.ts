import { config } from "dotenv";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "../src/db";

config({ path: ".env.local", quiet: true });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const { db, client } = createDb(url, { max: 1 });
  await migrate(db, { migrationsFolder: "./drizzle" });
  await client.end();
  console.log(`Migrated ${new URL(url).host}${new URL(url).pathname}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
