import { sql } from 'drizzle-orm';
import type { Db } from './client.js';

/** Test database from docker-compose. These are local dev credentials, not secrets. */
export const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://junro:junro@localhost:5434/junro_test';

/** Empties every table so each test starts from nothing. */
export async function resetDb(db: Db): Promise<void> {
  await db.execute(
    sql`TRUNCATE users, trips, days, stages, places, category_preferences, route_matrix_cache CASCADE`,
  );
}
