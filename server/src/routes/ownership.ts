import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { days, stages, trips } from '../db/schema.js';
import { notFoundError } from './helpers.js';

/**
 * The only way routes look up a trip, day or stage by id: always together with the
 * signed-in user. Someone else's row is reported as "not found", never as "forbidden".
 */
export async function requireOwnedTrip(db: Db, userId: string, tripId: string) {
  const [trip] = await db
    .select()
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.userId, userId)));
  if (!trip) throw notFoundError();
  return trip;
}

export async function requireOwnedDay(db: Db, userId: string, dayId: string) {
  const [row] = await db
    .select({ day: days })
    .from(days)
    .innerJoin(trips, eq(days.tripId, trips.id))
    .where(and(eq(days.id, dayId), eq(trips.userId, userId)));
  if (!row) throw notFoundError();
  return row.day;
}

export async function requireOwnedStage(db: Db, userId: string, stageId: string) {
  const [row] = await db
    .select({ stage: stages })
    .from(stages)
    .innerJoin(days, eq(stages.dayId, days.id))
    .innerJoin(trips, eq(days.tripId, trips.id))
    .where(and(eq(stages.id, stageId), eq(trips.userId, userId)));
  if (!row) throw notFoundError();
  return row.stage;
}
