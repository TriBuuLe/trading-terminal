import { sql } from "drizzle-orm";
import { createDb, type DB } from "../../src/db";
import { TEST_DATABASE_URL } from "../global-setup";

export function testDb(): { db: DB; close: () => Promise<void>; truncate: (...tables: string[]) => Promise<void> } {
  const { db, client } = createDb(TEST_DATABASE_URL, { max: 4 });
  return {
    db,
    close: () => client.end(),
    truncate: async (...tables) => {
      await db.execute(sql.raw(`truncate ${tables.join(", ")} restart identity cascade`));
    },
  };
}
