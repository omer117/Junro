import { runMigrations } from './migrate.js';
import { testDatabaseUrl } from './test-db.js';

/** Vitest runs this once before the server tests: bring the test database up to date. */
export default async function setup(): Promise<void> {
  await runMigrations(testDatabaseUrl);
}
