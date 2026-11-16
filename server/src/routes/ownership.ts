import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { days, segments, stages, trips } from '../db/schema.js';
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
    // A stage is on a day, or waits in the pool of a stay: either way it leads to a trip.
    .leftJoin(days, eq(stages.dayId, days.id))
    .leftJoin(segments, eq(stages.segmentId, segments.id))
    .innerJoin(trips, eq(trips.id, sql`coalesce(${days.tripId}, ${segments.tripId})`))
    .where(and(eq(stages.id, stageId), eq(trips.userId, userId)));
  if (!row) throw notFoundError();
  return row.stage;
}

export async function requireOwnedSegment(db: Db, userId: string, segmentId: string) {
  const [row] = await db
    .select({ segment: segments })
    .from(segments)
    .innerJoin(trips, eq(segments.tripId, trips.id))
    .where(and(eq(segments.id, segmentId), eq(trips.userId, userId)));
  if (!row) throw notFoundError();
  return row.segment;
}
