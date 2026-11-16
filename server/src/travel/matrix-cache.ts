import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { routeMatrixCache, type TravelMode } from '../db/schema.js';
import { tryRedis, type RedisHandle } from '../redis.js';

/** A cached matrix is forgotten after a day. Nothing needs deleting: a new write replaces it. */
export const MATRIX_TTL_SECONDS = 24 * 60 * 60;

const keyOf = (dayId: string, mode: TravelMode) => `junro:matrix:${dayId}:${mode}`;

/** The stored matrix of a day and travel mode straight from Postgres (the source of truth). */
export async function readMatrixFromDb(
  db: Db,
  dayId: string,
  mode: TravelMode,
): Promise<unknown | null> {
  const [row] = await db
    .select()
    .from(routeMatrixCache)
    .where(and(eq(routeMatrixCache.dayId, dayId), eq(routeMatrixCache.travelMode, mode)));
  return row ? row.matrix : null;
}

/**
 * Cache-aside read: Redis first, and on a miss Postgres, which then fills Redis for next time.
 * `fromRedis` tells the caller where the answer came from, because a Redis answer can be behind
 * (see the callers: a Redis value with a missing pair is checked against Postgres before Google).
 */
export async function readMatrix(
  db: Db,
  redis: RedisHandle | undefined,
  dayId: string,
  mode: TravelMode,
): Promise<{ matrix: unknown; fromRedis: boolean } | null> {
  const cached = await tryRedis(
    redis,
    (r) => r.get(keyOf(dayId, mode)),
    () => null,
  );
  if (cached !== null) {
    try {
      return { matrix: JSON.parse(cached) as unknown, fromRedis: true };
    } catch {
      // A damaged value is the same as a miss.
    }
  }

  const matrix = await readMatrixFromDb(db, dayId, mode);
  if (matrix === null) return null;
  await fillRedis(redis, dayId, mode, matrix);
  return { matrix, fromRedis: false };
}

/**
 * Writes Postgres first (it is the truth), then Redis. If the Redis write fails we lose speed,
 * never data.
 */
export async function writeMatrix(
  db: Db,
  redis: RedisHandle | undefined,
  dayId: string,
  mode: TravelMode,
  inputHash: string,
  matrix: unknown,
): Promise<void> {
  await db
    .insert(routeMatrixCache)
    .values({ dayId, travelMode: mode, inputHash, matrix })
    .onConflictDoUpdate({
      target: [routeMatrixCache.dayId, routeMatrixCache.travelMode],
      set: { inputHash, matrix },
    });
  await fillRedis(redis, dayId, mode, matrix);
}

async function fillRedis(
  redis: RedisHandle | undefined,
  dayId: string,
  mode: TravelMode,
  matrix: unknown,
): Promise<void> {
  await tryRedis(
    redis,
    (r) => r.set(keyOf(dayId, mode), JSON.stringify(matrix), MATRIX_TTL_SECONDS),
    () => undefined,
  );
}
