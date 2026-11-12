import { asc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/require-auth.js';
import type { Db } from '../db/client.js';
import { TRAVEL_MODES, days } from '../db/schema.js';
import { validateBody } from '../validate.js';
import { uuidParam } from './helpers.js';
import { requireOwnedDay, requireOwnedTrip } from './ownership.js';

const point = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

const dayBody = z.object({
  date: z.iso.date(),
  start: point,
  end: point,
  /** Minutes since midnight. */
  startTime: z.number().int().min(0).max(1439),
  travelMode: z.enum(TRAVEL_MODES),
});

const dayPatch = dayBody.partial();

type DayRow = typeof days.$inferSelect;

/** The API shape of a day: points are grouped, the database columns are flat. */
export function toDay(row: DayRow) {
  return {
    id: row.id,
    tripId: row.tripId,
    date: row.date,
    start: { lat: row.startLat, lng: row.startLng },
    end: { lat: row.endLat, lng: row.endLng },
    startTime: row.startTime,
    travelMode: row.travelMode,
  };
}

export function daysRouter(db: Db): Router {
  const router = Router();
  router.use(['/trips/:tripId/days', '/days'], requireAuth);

  router.get('/trips/:tripId/days', async (req, res) => {
    await requireOwnedTrip(db, req.user!.id, uuidParam(req.params.tripId));
    const rows = await db
      .select()
      .from(days)
      .where(eq(days.tripId, uuidParam(req.params.tripId)))
      .orderBy(asc(days.date), asc(days.startTime));
    res.json(rows.map(toDay));
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
        startTime: body.startTime,
        travelMode: body.travelMode,
      })
      .returning();
    res.status(201).json(toDay(row!));
  });

  router.get('/days/:id', async (req, res) => {
    res.json(toDay(await requireOwnedDay(db, req.user!.id, uuidParam(req.params.id))));
  });

  router.patch('/days/:id', validateBody(dayPatch), async (req, res) => {
    const day = await requireOwnedDay(db, req.user!.id, uuidParam(req.params.id));
    const body = req.body as z.infer<typeof dayPatch>;
    const changes = {
      ...(body.date !== undefined && { date: body.date }),
      ...(body.start && { startLat: body.start.lat, startLng: body.start.lng }),
      ...(body.end && { endLat: body.end.lat, endLng: body.end.lng }),
      ...(body.startTime !== undefined && { startTime: body.startTime }),
      ...(body.travelMode !== undefined && { travelMode: body.travelMode }),
    };
    if (Object.keys(changes).length === 0) {
      res.json(toDay(day));
      return;
    }
    const [row] = await db.update(days).set(changes).where(eq(days.id, day.id)).returning();
    res.json(toDay(row!));
  });

  router.delete('/days/:id', async (req, res) => {
    const day = await requireOwnedDay(db, req.user!.id, uuidParam(req.params.id));
    await db.delete(days).where(eq(days.id, day.id));
    res.sendStatus(204);
  });

  return router;
}
