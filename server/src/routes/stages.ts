import { MAX_STAGES } from '@junro/solver';
import { asc, count, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/require-auth.js';
import type { Db } from '../db/client.js';
import { CATEGORIES, PRIORITIES, days, places, stages } from '../db/schema.js';

type StageRow = typeof stages.$inferSelect;
import { HttpError } from '../errors.js';
import { validateBody } from '../validate.js';
import { uuidParam } from './helpers.js';
import { requireOwnedDay, requireOwnedStage } from './ownership.js';

/** A manual stay for one stage, in minutes (at most a full day). */
const override = z.number().int().min(1).max(1440);

export const createBody = z.object({
  placeId: z.uuid(),
  category: z.enum(CATEGORIES),
  stayOverrideMinutes: override.optional(),
  priority: z.enum(PRIORITIES).optional(),
});

const patchBody = z.object({
  category: z.enum(CATEGORIES).optional(),
  /** null removes the override. */
  stayOverrideMinutes: override.nullable().optional(),
  done: z.boolean().optional(),
  priority: z.enum(PRIORITIES).optional(),
  /** Move to a day of the same stay, or back to the pool (null). */
  dayId: z.uuid().nullable().optional(),
  /** Booked time (minutes since midnight); needs a day. null removes the booking. */
  pinnedTime: z.number().int().min(0).max(1439).nullable().optional(),
});

export const stageWithPlace = {
  id: stages.id,
  dayId: stages.dayId,
  segmentId: stages.segmentId,
  pinnedTime: stages.pinnedTime,
  category: stages.category,
  stayOverrideMinutes: stages.stayOverrideMinutes,
  done: stages.done,
  priority: stages.priority,
  dropped: stages.dropped,
  position: stages.position,
  place: {
    id: places.id,
    googlePlaceId: places.googlePlaceId,
    name: places.name,
    lat: places.lat,
    lng: places.lng,
  },
};

export function stagesRouter(db: Db): Router {
  const router = Router();
  router.use(['/days/:dayId/stages', '/stages'], requireAuth);

  const loadStage = async (id: string) => {
    const [row] = await db
      .select(stageWithPlace)
      .from(stages)
      .innerJoin(places, eq(stages.placeId, places.id))
      .where(eq(stages.id, id));
    return row!;
  };

  /**
   * What a change of day and/or booking does to the stage row. Moving is only for places of a
   * stay (`segmentId`); a move clears the route position, the dropped flag and the booking, since
   * those belonged to the old day.
   */
  const moveChanges = async (stage: StageRow, body: z.infer<typeof patchBody>, userId: string) => {
    if (body.dayId === undefined && body.pinnedTime === undefined) return {};

    let segmentId = stage.segmentId;
    if (!segmentId && stage.dayId) {
      const [home] = await db
        .select({ segmentId: days.segmentId })
        .from(days)
        .where(eq(days.id, stage.dayId));
      segmentId = home?.segmentId ?? null;
    }

    let dayId = stage.dayId;
    const changes: Partial<typeof stages.$inferInsert> = {};

    if (body.dayId !== undefined && body.dayId !== stage.dayId) {
      if (!segmentId) {
        throw new HttpError(400, 'not_in_stay', 'Only places of a stay can move between days');
      }
      if (body.dayId === null) {
        dayId = null;
      } else {
        const target = await requireOwnedDay(db, userId, body.dayId);
        if (target.segmentId !== segmentId) {
          throw new HttpError(400, 'wrong_stay', 'That day is not part of the same stay');
        }
        const [existing] = await db
          .select({ total: count() })
          .from(stages)
          .where(eq(stages.dayId, target.id));
        if (existing!.total >= MAX_STAGES) {
          throw new HttpError(409, 'day_full', `A day can have at most ${MAX_STAGES} stages`);
        }
        dayId = target.id;
      }
      // A booking belongs to a day, so a move clears it (unless this same change sets a new one).
      Object.assign(changes, {
        dayId,
        segmentId,
        position: null,
        dropped: false,
        pinnedTime: null,
      });
    }

    if (body.pinnedTime !== undefined) {
      if (body.pinnedTime !== null) {
        if (!dayId) {
          throw new HttpError(400, 'pin_needs_day', 'A booking needs a day, not the pool');
        }
        const target = await requireOwnedDay(db, userId, dayId);
        const end = target.endTime ?? 1440;
        if (body.pinnedTime < target.startTime || body.pinnedTime >= end) {
          throw new HttpError(400, 'pin_outside_day', 'The booked time is outside the day');
        }
      }
      changes.pinnedTime = body.pinnedTime;
    }
    return changes;
  };

  router.get('/days/:dayId/stages', async (req, res) => {
    const day = await requireOwnedDay(db, req.user!.id, uuidParam(req.params.dayId));
    const rows = await db
      .select(stageWithPlace)
      .from(stages)
      .innerJoin(places, eq(stages.placeId, places.id))
      .where(eq(stages.dayId, day.id))
      .orderBy(asc(stages.position), asc(stages.createdAt), asc(stages.id));
    res.json(rows);
  });

  router.post('/days/:dayId/stages', validateBody(createBody), async (req, res) => {
    const day = await requireOwnedDay(db, req.user!.id, uuidParam(req.params.dayId));
    const body = req.body as z.infer<typeof createBody>;

    const [existing] = await db
      .select({ total: count() })
      .from(stages)
      .where(eq(stages.dayId, day.id));
    if (existing!.total >= MAX_STAGES) {
      throw new HttpError(409, 'day_full', `A day can have at most ${MAX_STAGES} stages`);
    }

    const [place] = await db
      .select({ id: places.id })
      .from(places)
      .where(eq(places.id, body.placeId));
    if (!place) throw new HttpError(400, 'unknown_place', 'That place does not exist');

    const [created] = await db
      .insert(stages)
      .values({
        dayId: day.id,
        ...(day.segmentId && { segmentId: day.segmentId }),
        placeId: body.placeId,
        category: body.category,
        ...(body.priority !== undefined && { priority: body.priority }),
        ...(body.stayOverrideMinutes !== undefined && {
          stayOverrideMinutes: body.stayOverrideMinutes,
        }),
      })
      .returning({ id: stages.id });
    res.status(201).json(await loadStage(created!.id));
  });

  router.get('/stages/:id', async (req, res) => {
    const stage = await requireOwnedStage(db, req.user!.id, uuidParam(req.params.id));
    res.json(await loadStage(stage.id));
  });

  router.patch('/stages/:id', validateBody(patchBody), async (req, res) => {
    const stage = await requireOwnedStage(db, req.user!.id, uuidParam(req.params.id));
    const body = req.body as z.infer<typeof patchBody>;
    const move = await moveChanges(stage, body, req.user!.id);
    const changes = {
      ...move,
      ...(body.category !== undefined && { category: body.category }),
      ...(body.stayOverrideMinutes !== undefined && {
        stayOverrideMinutes: body.stayOverrideMinutes,
      }),
      ...(body.done !== undefined && { done: body.done }),
      ...(body.priority !== undefined && { priority: body.priority }),
    };
    if (Object.keys(changes).length > 0) {
      await db.update(stages).set(changes).where(eq(stages.id, stage.id));
    }
    res.json(await loadStage(stage.id));
  });

  router.delete('/stages/:id', async (req, res) => {
    const stage = await requireOwnedStage(db, req.user!.id, uuidParam(req.params.id));
    await db.delete(stages).where(eq(stages.id, stage.id));
    res.sendStatus(204);
  });

  return router;
}
