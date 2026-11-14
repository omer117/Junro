import { asc, count, eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/require-auth.js';
import type { Db } from '../db/client.js';
import { TRAVEL_MODES, days, stages } from '../db/schema.js';
import { validateBody } from '../validate.js';
import { uuidParam } from './helpers.js';
import { requireOwnedDay, requireOwnedTrip } from './ownership.js';

const point = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

const pointName = z.string().trim().min(1).max(100);

/** Real Google place ids look like "ChIJ...": letters, digits, - and _. */
const placeId = z.string().regex(/^[A-Za-z0-9_-]{10,200}$/);

const dayBody = z.object({
  date: z.iso.date(),
  start: point,
  end: point,
  startName: pointName.optional(),
  endName: pointName.optional(),
  startPlaceId: placeId.optional(),
  endPlaceId: placeId.optional(),
  /** Minutes since midnight. */
  startTime: z.number().int().min(0).max(1439),
  travelMode: z.enum(TRAVEL_MODES),
});

/** A change can also clear a name (null). */
const dayPatch = dayBody
  .omit({ startName: true, endName: true, startPlaceId: true, endPlaceId: true })
  .partial()
  .extend({ startName: pointName.nullable().optional(), endName: pointName.nullable().optional() });

type DayRow = typeof days.$inferSelect;

/** The API shape of a day: points are grouped, the database columns are flat. */
export function toDay(row: DayRow, stageCount: number) {
  return {
    id: row.id,
    tripId: row.tripId,
    date: row.date,
    start: { lat: row.startLat, lng: row.startLng },
    end: { lat: row.endLat, lng: row.endLng },
    startName: row.startName,
    endName: row.endName,
    startPlaceId: row.startPlaceId,
    endPlaceId: row.endPlaceId,
    startTime: row.startTime,
    travelMode: row.travelMode,
    stageCount,
  };
}

async function countStages(db: Db, dayId: string): Promise<number> {
  const [row] = await db.select({ total: count() }).from(stages).where(eq(stages.dayId, dayId));
  return row!.total;
}

export function daysRouter(db: Db): Router {
  const router = Router();
  router.use(['/trips/:tripId/days', '/days'], requireAuth);

  router.get('/trips/:tripId/days', async (req, res) => {
    await requireOwnedTrip(db, req.user!.id, uuidParam(req.params.tripId));
    const rows = await db
      .select({
        day: days,
        // One query for the whole list: how many stages each day has.
        // Table names are written out: Drizzle leaves them off column references when the query
        // has a single table, which would make this compare the wrong columns.
        stageCount: sql<number>`(select count(*)::int from "stages" "s" where "s"."day_id" = "days"."id")`,
      })
      .from(days)
      .where(eq(days.tripId, uuidParam(req.params.tripId)))
      .orderBy(asc(days.date), asc(days.startTime));
    res.json(rows.map((r) => toDay(r.day, r.stageCount)));
  });

  router.post('/trips/:tripId/days', validateBody(dayBody), async (req, res) => {
    const trip = await requireOwnedTrip(db, req.user!.id, uuidParam(req.params.tripId));
    const body = req.body as z.infer<typeof dayBody>;
    const [row] = await db
      .insert(days)
      .values({
        tripId: trip.id,
        date: body.date,
        startLat: body.start.lat,
        startLng: body.start.lng,
        endLat: body.end.lat,
        endLng: body.end.lng,
        startName: body.startName ?? null,
        endName: body.endName ?? null,
        startPlaceId: body.startPlaceId ?? null,
        endPlaceId: body.endPlaceId ?? null,
        startTime: body.startTime,
        travelMode: body.travelMode,
      })
      .returning();
    res.status(201).json(toDay(row!, 0));
  });

  router.get('/days/:id', async (req, res) => {
    const day = await requireOwnedDay(db, req.user!.id, uuidParam(req.params.id));
    res.json(toDay(day, await countStages(db, day.id)));
  });

  router.patch('/days/:id', validateBody(dayPatch), async (req, res) => {
    const day = await requireOwnedDay(db, req.user!.id, uuidParam(req.params.id));
    const body = req.body as z.infer<typeof dayPatch>;
    const changes = {
      ...(body.date !== undefined && { date: body.date }),
      ...(body.start && { startLat: body.start.lat, startLng: body.start.lng }),
      ...(body.end && { endLat: body.end.lat, endLng: body.end.lng }),
      ...(body.startName !== undefined && { startName: body.startName }),
      ...(body.endName !== undefined && { endName: body.endName }),
      ...(body.startTime !== undefined && { startTime: body.startTime }),
      ...(body.travelMode !== undefined && { travelMode: body.travelMode }),
    };
    if (Object.keys(changes).length === 0) {
      res.json(toDay(day, await countStages(db, day.id)));
      return;
    }
    const [row] = await db.update(days).set(changes).where(eq(days.id, day.id)).returning();
    res.json(toDay(row!, await countStages(db, day.id)));
  });

  router.delete('/days/:id', async (req, res) => {
    const day = await requireOwnedDay(db, req.user!.id, uuidParam(req.params.id));
    await db.delete(days).where(eq(days.id, day.id));
    res.sendStatus(204);
  });

  return router;
}
