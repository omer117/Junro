import { MAX_STAGES } from '@junro/solver';
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/require-auth.js';
import type { Db } from '../db/client.js';
import { TRAVEL_MODES, days, places, segments, stages } from '../db/schema.js';
import { HttpError } from '../errors.js';
import { validateBody } from '../validate.js';
import { uuidParam } from './helpers.js';
import { toDay } from './days.js';
import { requireOwnedSegment, requireOwnedTrip } from './ownership.js';
import { createBody, stageWithPlace } from './stages.js';

/** A stay is 1 to 10 days; more would make the split too slow to be useful. */
export const MAX_SEGMENT_DAYS = 10;
/** Places in a whole stay: at most 60, and at most a full day's worth for each day. */
export const maxSegmentPlaces = (dayCount: number) => Math.min(60, MAX_STAGES * dayCount);

const point = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const name = z.string().trim().min(1).max(100);
const placeId = z.string().regex(/^[A-Za-z0-9_-]{10,200}$/);

const segmentBody = z
  .object({
    name,
    firstDate: z.iso.date(),
    dayCount: z.number().int().min(1).max(MAX_SEGMENT_DAYS),
    hotel: point,
    hotelName: name.optional(),
    hotelPlaceId: placeId.optional(),
    travelMode: z.enum(TRAVEL_MODES),
    startTime: z.number().int().min(0).max(1439),
    endTime: z.number().int().min(1).max(2879).optional(),
  })
  .refine((s) => s.endTime === undefined || s.endTime > s.startTime, {
    message: 'The day must end after it starts',
    path: ['endTime'],
  });

const segmentPatch = z.object({
  name: name.optional(),
  travelMode: z.enum(TRAVEL_MODES).optional(),
  startTime: z.number().int().min(0).max(1439).optional(),
  endTime: z.number().int().min(1).max(2879).nullable().optional(),
});

type SegmentRow = typeof segments.$inferSelect;

/** `2027-04-01` plus some days, in UTC so the machine's time zone never matters. */
export function addDays(date: string, amount: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}

export function toSegment(
  row: SegmentRow,
  facts: { firstDate: string | null; dayCount: number; placeCount: number },
) {
  return {
    id: row.id,
    tripId: row.tripId,
    name: row.name,
    hotel: { lat: row.hotelLat, lng: row.hotelLng },
    hotelName: row.hotelName,
    hotelPlaceId: row.hotelPlaceId,
    travelMode: row.travelMode,
    startTime: row.startTime,
    endTime: row.endTime,
    firstDate: facts.firstDate,
    dayCount: facts.dayCount,
    placeCount: facts.placeCount,
  };
}

export function segmentsRouter(db: Db): Router {
  const router = Router();
  router.use(['/trips/:tripId/segments', '/segments'], requireAuth);

  const factsOf = async (segmentId: string) => {
    const [d] = await db
      .select({ first: sql<string | null>`min(${days.date})::text`, total: count() })
      .from(days)
      .where(eq(days.segmentId, segmentId));
    const [p] = await db
      .select({ total: count() })
      .from(stages)
      .where(eq(stages.segmentId, segmentId));
    return { firstDate: d!.first, dayCount: d!.total, placeCount: p!.total };
  };

  router.get('/trips/:tripId/segments', async (req, res) => {
    const trip = await requireOwnedTrip(db, req.user!.id, uuidParam(req.params.tripId));
    const rows = await db.select().from(segments).where(eq(segments.tripId, trip.id));
    const all = await Promise.all(rows.map(async (row) => toSegment(row, await factsOf(row.id))));
    res.json(all.sort((a, b) => (a.firstDate ?? '').localeCompare(b.firstDate ?? '')));
  });

  router.post('/trips/:tripId/segments', validateBody(segmentBody), async (req, res) => {
    const trip = await requireOwnedTrip(db, req.user!.id, uuidParam(req.params.tripId));
    const body = req.body as z.infer<typeof segmentBody>;
    const lastDate = addDays(body.firstDate, body.dayCount - 1);

    // Two stays of one trip cannot share a date.
    const existing = await db
      .select({
        first: sql<string>`min(${days.date})::text`,
        last: sql<string>`max(${days.date})::text`,
      })
      .from(days)
      .where(and(eq(days.tripId, trip.id), sql`${days.segmentId} is not null`))
      .groupBy(days.segmentId);
    if (existing.some((s) => body.firstDate <= s.last && lastDate >= s.first)) {
      throw new HttpError(
        409,
        'segment_overlap',
        'Another stay of this trip uses some of these dates',
      );
    }

    const created = await db.transaction(async (tx) => {
      const [segment] = await tx
        .insert(segments)
        .values({
          tripId: trip.id,
          name: body.name,
          hotelLat: body.hotel.lat,
          hotelLng: body.hotel.lng,
          hotelName: body.hotelName ?? null,
          hotelPlaceId: body.hotelPlaceId ?? null,
          travelMode: body.travelMode,
          startTime: body.startTime,
          endTime: body.endTime ?? null,
        })
        .returning();
      await tx.insert(days).values(
        Array.from({ length: body.dayCount }, (_, i) => ({
          tripId: trip.id,
          segmentId: segment!.id,
          date: addDays(body.firstDate, i),
          startLat: body.hotel.lat,
          startLng: body.hotel.lng,
          endLat: body.hotel.lat,
          endLng: body.hotel.lng,
          startName: body.hotelName ?? null,
          endName: body.hotelName ?? null,
          startPlaceId: body.hotelPlaceId ?? null,
          endPlaceId: body.hotelPlaceId ?? null,
          startTime: body.startTime,
          endTime: body.endTime ?? null,
          travelMode: body.travelMode,
        })),
      );
      return segment!;
    });
    res.status(201).json(toSegment(created, await factsOf(created.id)));
  });

  router.get('/segments/:id', async (req, res) => {
    const segment = await requireOwnedSegment(db, req.user!.id, uuidParam(req.params.id));
    const rows = await db
      .select({
        day: days,
        stageCount: sql<number>`(select count(*)::int from "stages" "s" where "s"."day_id" = "days"."id")`,
      })
      .from(days)
      .where(eq(days.segmentId, segment.id))
      .orderBy(asc(days.date), asc(days.startTime));
    res.json({
      ...toSegment(segment, await factsOf(segment.id)),
      days: rows.map((r) => toDay(r.day, r.stageCount)),
    });
  });

  router.patch('/segments/:id', validateBody(segmentPatch), async (req, res) => {
    const segment = await requireOwnedSegment(db, req.user!.id, uuidParam(req.params.id));
    const body = req.body as z.infer<typeof segmentPatch>;
    const startTime = body.startTime ?? segment.startTime;
    const endTime = body.endTime !== undefined ? body.endTime : segment.endTime;
    if (endTime !== null && endTime <= startTime) {
      throw new HttpError(400, 'validation_error', 'The day must end after it starts', [
        { path: 'endTime', message: 'The day must end after it starts' },
      ]);
    }
    const changes = {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.travelMode !== undefined && { travelMode: body.travelMode }),
      ...(body.startTime !== undefined && { startTime: body.startTime }),
      ...(body.endTime !== undefined && { endTime: body.endTime }),
    };
    const [row] =
      Object.keys(changes).length > 0
        ? await db.update(segments).set(changes).where(eq(segments.id, segment.id)).returning()
        : [segment];
    res.json(toSegment(row!, await factsOf(segment.id)));
  });

  router.delete('/segments/:id', async (req, res) => {
    const segment = await requireOwnedSegment(db, req.user!.id, uuidParam(req.params.id));
    // Its days and places go with it (cascade).
    await db.delete(segments).where(eq(segments.id, segment.id));
    res.sendStatus(204);
  });

  /** The places collected for the stay that are not on any day yet. */
  router.get('/segments/:id/pool', async (req, res) => {
    const segment = await requireOwnedSegment(db, req.user!.id, uuidParam(req.params.id));
    const rows = await db
      .select(stageWithPlace)
      .from(stages)
      .innerJoin(places, eq(stages.placeId, places.id))
      .where(and(eq(stages.segmentId, segment.id), isNull(stages.dayId)))
      .orderBy(asc(stages.createdAt), asc(stages.id));
    res.json(rows);
  });

  router.post('/segments/:id/stages', validateBody(createBody), async (req, res) => {
    const segment = await requireOwnedSegment(db, req.user!.id, uuidParam(req.params.id));
    const body = req.body as z.infer<typeof createBody>;
    const facts = await factsOf(segment.id);
    if (facts.placeCount >= maxSegmentPlaces(facts.dayCount)) {
      throw new HttpError(
        409,
        'stay_full',
        `A stay of ${facts.dayCount} days can have at most ${maxSegmentPlaces(facts.dayCount)} places`,
      );
    }
    const [place] = await db
      .select({ id: places.id })
      .from(places)
      .where(eq(places.id, body.placeId));
    if (!place) throw new HttpError(400, 'unknown_place', 'That place does not exist');

    const [created] = await db
      .insert(stages)
      .values({
        segmentId: segment.id,
        placeId: body.placeId,
        category: body.category,
        ...(body.priority !== undefined && { priority: body.priority }),
        ...(body.stayOverrideMinutes !== undefined && {
          stayOverrideMinutes: body.stayOverrideMinutes,
        }),
      })
      .returning({ id: stages.id });
    const [row] = await db
      .select(stageWithPlace)
      .from(stages)
      .innerJoin(places, eq(stages.placeId, places.id))
      .where(eq(stages.id, created!.id));
    res.status(201).json(row);
  });

  return router;
}
